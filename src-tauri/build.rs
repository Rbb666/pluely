fn main() {
    dotenv::dotenv().ok();
    prepare_migration_seed();

    if let Ok(payment_endpoint) = std::env::var("PAYMENT_ENDPOINT") {
        println!("cargo:rustc-env=PAYMENT_ENDPOINT={}", payment_endpoint);
    }

    if let Ok(api_access_key) = std::env::var("API_ACCESS_KEY") {
        println!("cargo:rustc-env=API_ACCESS_KEY={}", api_access_key);
    }

    if let Ok(app_endpoint) = std::env::var("APP_ENDPOINT") {
        println!("cargo:rustc-env=APP_ENDPOINT={}", app_endpoint);
    }

    if let Ok(posthog_api_key) = std::env::var("POSTHOG_API_KEY") {
        println!("cargo:rustc-env=POSTHOG_API_KEY={}", posthog_api_key);
    }

    tauri_build::build()
}

fn prepare_migration_seed() {
    use std::{env, fs, path::PathBuf};
    const VARIABLE: &str = "PLUELY_MIGRATION_SEED_DIR";
    println!("cargo:rerun-if-env-changed={VARIABLE}");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is not set"));
    let generated = output.join("migration_seed.rs");
    let Some(source) = env::var_os(VARIABLE).filter(|value| !value.is_empty()) else {
        fs::write(generated, "const EMBEDDED_SEED: Option<EmbeddedSeed> = None;\n")
            .expect("could not prepare empty migration seed");
        return;
    };
    let source = PathBuf::from(source).canonicalize().expect("migration seed directory is unavailable");
    let destination = output.join("private-migration-seed");
    fs::create_dir_all(&destination).expect("could not prepare migration build directory");
    // The directory watch also catches the optional secure_storage file being added/removed.
    println!("cargo:rerun-if-changed={}", source.display());
    let mut paths = Vec::new();
    for filename in ["manifest.json", "settings.json", "pluely.db"] {
        let from = source.join(filename);
        let to = destination.join(filename);
        println!("cargo:rerun-if-changed={}", from.display());
        fs::copy(&from, &to).unwrap_or_else(|_| panic!("required migration file {filename} is unavailable"));
        paths.push(to.to_string_lossy().into_owned());
    }
    let secure_source = source.join("secure_storage.json");
    let secure_expression = if secure_source.is_file() {
        let secure_destination = destination.join("secure_storage.json");
        println!("cargo:rerun-if-changed={}", secure_source.display());
        fs::copy(secure_source, &secure_destination).expect("could not prepare migration license configuration");
        format!("Some(include_bytes!({:?}))", secure_destination.to_string_lossy())
    } else {
        "None".to_string()
    };
    // File content is never placed in Cargo output or the generated source file.
    let declaration = format!(
        "const EMBEDDED_SEED: Option<EmbeddedSeed> = Some(EmbeddedSeed {{ manifest: include_bytes!({:?}), settings: include_bytes!({:?}), database: include_bytes!({:?}), secure_storage: {} }});\n",
        paths[0], paths[1], paths[2], secure_expression
    );
    fs::write(generated, declaration).expect("could not prepare embedded migration seed");
}
