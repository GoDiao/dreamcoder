use std::path::{Path, PathBuf};

pub(crate) fn is_executable(path: &str) -> bool {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

// Keep detection independent of the process environment so all platforms and
// stale SHELL values can be tested without changing global environment variables.
pub(crate) fn detect_posix_shell(
    macos: bool,
    env_shell: Option<&str>,
    passwd_shell: Option<&str>,
    executable: impl Fn(&str) -> bool,
) -> String {
    [env_shell, passwd_shell]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|shell| !shell.is_empty() && executable(shell))
        .unwrap_or(if macos { "/bin/zsh" } else { "/bin/bash" })
        .to_string()
}

pub(crate) fn passwd_shell(contents: &str, uid: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let fields: Vec<_> = line.split(':').collect();
        if fields.len() == 7 && fields[2] == uid {
            Some(fields[6].trim().to_string())
        } else {
            None
        }
    })
}

pub(crate) fn resolve_posix_override(
    choice: &str,
    custom_path: Option<&str>,
    search_dirs: &[PathBuf],
    executable: impl Fn(&str) -> bool,
) -> Result<Option<String>, String> {
    match choice {
        "zsh" | "bash" | "fish" => search_dirs
            .iter()
            .map(|dir| dir.join(choice).to_string_lossy().into_owned())
            .find(|path| executable(path))
            .map(Some)
            .ok_or_else(|| format!("terminal shell {choice} is not installed or executable")),
        "custom" => {
            let path = custom_path.unwrap_or_default().trim();
            if !executable(path) {
                return Err(format!(
                    "custom terminal shell must be an absolute executable path: {path}"
                ));
            }
            Ok(Some(path.to_string()))
        }
        // Preferences may have been copied from a Windows installation.
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_prefers_valid_environment_shell_including_fish() {
        for shell in ["/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish"] {
            assert_eq!(
                detect_posix_shell(true, Some(shell), Some("/bin/bash"), |_| true),
                shell
            );
        }
    }

    #[test]
    fn detection_uses_passwd_when_environment_is_missing_blank_or_stale() {
        for shell in [None, Some(""), Some("  "), Some("/missing/fish")] {
            assert_eq!(
                detect_posix_shell(false, shell, Some("/usr/bin/fish"), |p| p
                    == "/usr/bin/fish"),
                "/usr/bin/fish"
            );
        }
    }

    #[test]
    fn detection_falls_back_by_platform_and_trims_paths() {
        assert_eq!(detect_posix_shell(true, None, None, |_| false), "/bin/zsh");
        assert_eq!(
            detect_posix_shell(false, Some("/missing"), Some(""), |_| false),
            "/bin/bash"
        );
        assert_eq!(
            detect_posix_shell(false, Some(" /bin/bash "), None, |_| true),
            "/bin/bash"
        );
    }

    #[test]
    fn passwd_lookup_matches_uid_and_ignores_malformed_rows() {
        let passwd = "# comment\nroot:x:0:0:root:/root:/bin/sh\nbad:501\nuser:x:501:20:User:/home/user:/usr/bin/fish\n";
        assert_eq!(
            passwd_shell(passwd, "501").as_deref(),
            Some("/usr/bin/fish")
        );
        assert_eq!(passwd_shell(passwd, "502"), None);
    }

    #[test]
    fn explicit_shells_search_path_and_report_missing_installations() {
        let dirs = vec![PathBuf::from("/bin"), PathBuf::from("/opt/homebrew/bin")];
        for choice in ["bash", "zsh", "fish"] {
            let installed = format!("/opt/homebrew/bin/{choice}");
            assert_eq!(
                resolve_posix_override(choice, None, &dirs, |p| p == installed).unwrap(),
                Some(installed)
            );
        }
        assert!(resolve_posix_override("fish", None, &dirs, |_| false).is_err());
    }

    #[test]
    fn custom_shells_validate_and_system_or_windows_choices_use_detection() {
        assert_eq!(
            resolve_posix_override("custom", Some(" /custom/fish "), &[], |p| p
                == "/custom/fish")
            .unwrap(),
            Some("/custom/fish".into())
        );
        assert!(resolve_posix_override("custom", None, &[], |_| false).is_err());
        for choice in ["system", "pwsh", "unknown"] {
            assert_eq!(
                resolve_posix_override(choice, None, &[], |_| false).unwrap(),
                None
            );
        }
    }

    #[test]
    fn executable_check_rejects_relative_missing_directory_and_non_executable_paths() {
        assert!(!is_executable("bash"));
        assert!(!is_executable("/missing/dreamcoder-shell"));
        assert!(!is_executable("/tmp"));
        #[cfg(unix)]
        {
            assert!(!is_executable("/etc/passwd"));
            assert!(is_executable("/bin/sh"));
        }
    }
}
