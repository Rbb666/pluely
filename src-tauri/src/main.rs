// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod portable_runtime;

fn main() {
    #[cfg(target_os = "windows")]
    portable_runtime::configure();
    pluely_lib::run()
}
