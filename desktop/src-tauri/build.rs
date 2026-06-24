fn main() {
    #[cfg(target_os = "macos")]
    {
        use std::{env, path::PathBuf, process::Command};

        let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));
        let target = env::var("TARGET").expect("TARGET is set by Cargo");
        let arch = match target.as_str() {
            "aarch64-apple-darwin" => "arm64",
            "x86_64-apple-darwin" => "x86_64",
            _ => panic!("unsupported macOS notification bridge target: {target}"),
        };
        let object_path = out_dir.join("macos_notifications.o");
        let source_path = PathBuf::from("src/macos_notifications.m");

        println!("cargo:rerun-if-changed={}", source_path.display());
        println!("cargo:rerun-if-env-changed=TARGET");

        let status = Command::new("clang")
            .args([
                "-fobjc-arc",
                "-c",
                "-arch",
                arch,
                source_path
                    .to_str()
                    .expect("notification bridge path is UTF-8"),
                "-o",
                object_path
                    .to_str()
                    .expect("compiled notification bridge path is UTF-8"),
            ])
            .status()
            .expect("failed to invoke clang for macOS notification bridge");

        if !status.success() {
            panic!("failed to compile macOS notification bridge");
        }

        println!("cargo:rustc-link-arg={}", object_path.display());
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
    }

    tauri_build::build()
}
