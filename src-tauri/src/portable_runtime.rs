//! Find the private WebView2 shipped by the portable launcher, including when
//! Windows autostart launches the inner application directly.
use std::path::{Path, PathBuf};

fn find_runtime(executable: &Path) -> Option<PathBuf> {
    let directory = executable.parent()?;
    let mut candidates = vec![directory.join("runtime")];
    if directory.file_name().and_then(|name| name.to_str()) == Some("app") {
        if let Some(parent) = directory.parent() {
            candidates.push(parent.join("runtime"));
        }
    }
    candidates.into_iter().find(|path| path.join("msedgewebview2.exe").is_file())
}

pub fn configure() {
    if let Ok(executable) = std::env::current_exe() {
        if let Some(runtime) = find_runtime(&executable).and_then(|path| path.canonicalize().ok()) {
            // Called before Tauri starts threads; this only affects this process.
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_private_runtime_in_both_supported_layouts() {
        let root = std::env::temp_dir().join(format!("pluely-runtime-test-{}", std::process::id()));
        fs::create_dir_all(root.join("runtime")).unwrap();
        fs::write(root.join("runtime/msedgewebview2.exe"), b"test-only").unwrap();
        assert_eq!(find_runtime(&root.join("Pluely.exe")), Some(root.join("runtime")));
        assert_eq!(find_runtime(&root.join("app/Pluely.exe")), Some(root.join("runtime")));
        assert_eq!(find_runtime(&root.join("unrelated/Pluely.exe")), None);
        fs::remove_file(root.join("runtime/msedgewebview2.exe")).unwrap();
        fs::remove_dir(root.join("runtime")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
