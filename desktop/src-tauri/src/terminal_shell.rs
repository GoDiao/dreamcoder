use std::path::{Path, PathBuf};

pub(crate) fn is_executable(path: &str) -> bool {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        nix::unistd::access(path, nix::unistd::AccessFlags::X_OK).is_ok()
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
    account_shell: Option<&str>,
    executable: impl Fn(&str) -> bool,
) -> String {
    [env_shell, account_shell]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|shell| !shell.is_empty() && executable(shell))
        .unwrap_or(if macos { "/bin/zsh" } else { "/bin/bash" })
        .to_string()
}

#[cfg(unix)]
pub(crate) fn account_shell() -> Option<String> {
    use nix::unistd::{Uid, User};
    // getpwuid_r consults Open Directory on macOS and NSS on Linux. The
    // reentrant API also avoids sharing a static passwd buffer across threads.
    User::from_uid(Uid::current())
        .ok()
        .flatten()
        .map(|user| user.shell.to_string_lossy().into_owned())
}

pub(crate) fn shell_search_dirs(macos: bool, path: Option<&std::ffi::OsStr>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if macos {
        // Explicit Unix shell choices prefer Homebrew over Apple's old /bin/bash,
        // even when a GUI launch puts system directories first in PATH.
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    if let Some(path) = path {
        dirs.extend(std::env::split_paths(path).filter(|dir| dir.is_absolute()));
    }
    dirs.extend(["/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    dirs
}

#[derive(Debug)]
pub(crate) struct ShellSelection {
    pub shell: String,
    pub warning: Option<String>,
    system_default: String,
}

pub(crate) fn select_shell(
    system_default: String,
    configured: Result<Option<String>, String>,
) -> ShellSelection {
    let (shell, warning) = match configured {
        Ok(Some(shell)) => (shell, None),
        Ok(None) => (system_default.clone(), None),
        Err(error) => (system_default.clone(), Some(error)),
    };
    ShellSelection {
        shell,
        warning,
        system_default,
    }
}

pub(crate) fn spawn_with_fallback<T, E: std::fmt::Display>(
    mut selection: ShellSelection,
    mut spawn: impl FnMut(&str) -> Result<T, E>,
) -> Result<(T, ShellSelection), String> {
    match spawn(&selection.shell) {
        Ok(child) => Ok((child, selection)),
        Err(error) if selection.shell != selection.system_default => {
            // Retry if the executable disappears after validation, or exec itself
            // fails (for example, an incompatible custom binary).
            selection.warning = Some(format!("could not start {}: {error}", selection.shell));
            selection.shell = selection.system_default.clone();
            let child = spawn(&selection.shell)
                .map_err(|error| format!("spawn fallback shell {}: {error}", selection.shell))?;
            Ok((child, selection))
        }
        Err(error) => Err(format!("spawn terminal shell {}: {error}", selection.shell)),
    }
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
    fn detection_uses_account_shell_when_environment_is_missing_blank_or_stale() {
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
    #[cfg(unix)]
    fn account_lookup_reads_current_user_through_system_database() {
        let shell = account_shell().expect("current user has an account shell");
        assert!(Path::new(&shell).is_absolute());
    }

    #[cfg(unix)]
    #[test]
    fn macos_explicit_choices_prefer_homebrew_but_linux_respects_path() {
        let path = std::ffi::OsStr::new("/bin:/usr/bin:/custom/bin:relative");
        let mac_dirs = shell_search_dirs(true, Some(path));
        let linux_dirs = shell_search_dirs(false, Some(path));
        let installed = |path: &str| ["/bin/bash", "/opt/homebrew/bin/bash"].contains(&path);
        assert_eq!(
            resolve_posix_override("bash", None, &mac_dirs, installed).unwrap(),
            Some("/opt/homebrew/bin/bash".into())
        );
        assert_eq!(
            resolve_posix_override("bash", None, &linux_dirs, installed).unwrap(),
            Some("/bin/bash".into())
        );
        assert!(mac_dirs.iter().all(|path| path.is_absolute()));
        assert_eq!(
            resolve_posix_override("bash", None, &mac_dirs, |path| path == "/bin/bash").unwrap(),
            Some("/bin/bash".into())
        );
    }

    #[test]
    fn missing_named_and_custom_shells_fall_back_with_warning() {
        for (choice, custom) in [("fish", None), ("custom", Some("/missing/shell"))] {
            let configured = resolve_posix_override(choice, custom, &[], |_| false);
            let selection = select_shell("/bin/bash".into(), configured);
            let (started, selection) =
                spawn_with_fallback(selection, |shell| Ok::<_, String>(shell.to_string())).unwrap();
            assert_eq!(started, "/bin/bash");
            assert!(selection.warning.is_some());
        }
    }

    #[test]
    fn executable_that_fails_to_spawn_retries_system_shell_once() {
        let selection = select_shell("/bin/bash".into(), Ok(Some("/custom/fish".into())));
        let mut attempts = Vec::new();
        let (_, selected) = spawn_with_fallback(selection, |shell| {
            attempts.push(shell.to_string());
            if shell == "/custom/fish" {
                Err("executable disappeared")
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts, ["/custom/fish", "/bin/bash"]);
        assert_eq!(selected.shell, "/bin/bash");
        assert!(selected.warning.unwrap().contains("executable disappeared"));
    }

    #[test]
    fn valid_override_or_system_choice_runs_without_warning() {
        for configured in [Ok(None), Ok(Some("/custom/fish".into()))] {
            let selection = select_shell("/bin/bash".into(), configured);
            let expected = selection.shell.clone();
            let (_, selected) = spawn_with_fallback(selection, |shell| {
                assert_eq!(shell, expected);
                Ok::<_, String>(())
            })
            .unwrap();
            assert!(selected.warning.is_none());
        }
    }

    #[test]
    fn failing_system_default_still_reports_an_error_without_retrying() {
        let selection = select_shell("/missing/bash".into(), Ok(None));
        let mut attempts = 0;
        let result = spawn_with_fallback(selection, |_| {
            attempts += 1;
            Err::<(), _>("not found")
        });
        assert!(result.unwrap_err().contains("/missing/bash"));
        assert_eq!(attempts, 1);
    }

    #[cfg(unix)]
    #[test]
    fn real_pty_starts_fallback_when_preferred_executable_cannot_spawn() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let selection = select_shell(
            "/bin/sh".into(),
            Ok(Some("/missing/dreamcoder-shell".into())),
        );
        let (mut child, selected) = spawn_with_fallback(selection, |shell| {
            let mut cmd = CommandBuilder::new(shell);
            cmd.args(["-c", "exit 0"]);
            pair.slave.spawn_command(cmd)
        })
        .unwrap();
        drop(pair.slave);
        assert_eq!(selected.shell, "/bin/sh");
        assert!(selected.warning.is_some());
        assert_eq!(child.wait().unwrap().exit_code(), 0);
    }

    #[cfg(unix)]
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
