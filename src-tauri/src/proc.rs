//! Processus enfants **annulables**, avec toute leur descendance.
//!
//! yt-dlp lance FFmpeg, Chromium lance ses processus de rendu : tuer
//! seulement le processus que l'on a démarré laisserait des orphelins qui
//! continuent à télécharger ou à encoder. Chaque enfant est donc placé dans un
//! groupe qu'on peut abattre d'un coup :
//!
//! * **Unix** — un groupe de processus propre (`process_group(0)`), abattu par
//!   `killpg` ;
//! * **Windows** — un objet *job* configuré pour tuer ses membres à sa
//!   fermeture, auquel l'enfant est rattaché.
//!
//! Aucune commande ne passe par un interpréteur : le programme et ses
//! arguments sont des valeurs distinctes.

use std::io::{self, Read};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
pub enum Outcome {
    Exited(ExitStatus),
    /// L'appelant a demandé l'arrêt : le groupe entier a été abattu.
    Cancelled,
    /// Le délai imparti est écoulé : le groupe entier a été abattu.
    TimedOut,
}

/// Un enfant et son groupe.
pub struct Group {
    child: Child,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl Group {
    pub fn spawn(command: &mut Command) -> io::Result<Group> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // Pas de fenêtre de console qui clignote devant l'utilisateur.
            command.creation_flags(0x0800_0000);
        }
        let child = command.spawn()?;
        #[cfg(windows)]
        {
            let job = windows_job::attach(&child);
            return Ok(Group { child, job });
        }
        #[cfg(not(windows))]
        Ok(Group { child })
    }

    pub fn child_mut(&mut self) -> &mut Child {
        &mut self.child
    }

    /// Abat l'enfant et toute sa descendance, puis le récolte.
    pub fn kill(&mut self) {
        #[cfg(unix)]
        {
            // Le groupe porte l'identifiant de son meneur.
            unsafe {
                libc::killpg(self.child.id() as libc::pid_t, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            windows_job::terminate(self.job);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        // Un enfant encore vivant à la destruction est un orphelin en puissance.
        if matches!(self.child.try_wait(), Ok(None)) {
            self.kill();
        }
        #[cfg(windows)]
        windows_job::close(self.job);
    }
}

#[cfg(windows)]
mod windows_job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Crée un job « tuer à la fermeture » et y rattache l'enfant. En cas
    /// d'échec on continue sans job : `kill` tue alors au moins l'enfant direct.
    pub fn attach(child: &Child) -> HANDLE {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return std::ptr::null_mut();
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            job
        }
    }

    pub fn terminate(job: HANDLE) {
        if !job.is_null() {
            unsafe {
                TerminateJobObject(job, 1);
            }
        }
    }

    pub fn close(job: HANDLE) {
        if !job.is_null() {
            unsafe {
                CloseHandle(job);
            }
        }
    }
}

/// Lit un flux et en tire des lignes, qu'elles se terminent par `\n` ou `\r`
/// (FFmpeg et yt-dlp réécrivent leur ligne de progression avec `\r`).
fn pump(mut reader: impl Read + Send + 'static, stream: Stream, sender: mpsc::Sender<(Stream, String)>) {
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            for &byte in &buffer[..read] {
                if byte == b'\n' || byte == b'\r' {
                    if !pending.is_empty() {
                        let line = String::from_utf8_lossy(&pending).to_string();
                        if sender.send((stream, line)).is_err() {
                            return;
                        }
                        pending.clear();
                    }
                } else if pending.len() < 64 * 1024 {
                    pending.push(byte);
                }
            }
        }
        if !pending.is_empty() {
            let _ = sender.send((stream, String::from_utf8_lossy(&pending).to_string()));
        }
    });
}

/// Exécute `command` en relayant chaque ligne de ses sorties à `on_line`.
///
/// `cancelled` est interrogé une vingtaine de fois par seconde ; dès qu'il
/// répond `true`, tout le groupe est abattu. `timeout` borne la durée totale.
pub fn run_streaming(
    command: &mut Command,
    timeout: Option<Duration>,
    cancelled: &dyn Fn() -> bool,
    on_line: &mut dyn FnMut(Stream, &str),
) -> io::Result<Outcome> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut group = Group::spawn(command)?;
    let (sender, receiver) = mpsc::channel();
    if let Some(out) = group.child_mut().stdout.take() {
        pump(out, Stream::Stdout, sender.clone());
    }
    if let Some(err) = group.child_mut().stderr.take() {
        pump(err, Stream::Stderr, sender.clone());
    }
    drop(sender);

    let deadline = timeout.map(|t| Instant::now() + t);
    let mut exited: Option<ExitStatus> = None;
    loop {
        if cancelled() {
            group.kill();
            return Ok(Outcome::Cancelled);
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            group.kill();
            return Ok(Outcome::TimedOut);
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok((stream, line)) => on_line(stream, &line),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            // Les deux flux sont fermés : le processus a terminé (ou fermé ses sorties).
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if exited.is_none() {
                    exited = Some(wait_bounded(&mut group, cancelled, deadline)?);
                }
                break;
            }
        }
    }
    match exited {
        Some(status) => Ok(Outcome::Exited(status)),
        None => Ok(Outcome::Exited(group.child_mut().wait()?)),
    }
}

/// Attend la fin d'un enfant dont les sorties sont fermées, sans bloquer l'annulation.
fn wait_bounded(group: &mut Group, cancelled: &dyn Fn() -> bool, deadline: Option<Instant>) -> io::Result<ExitStatus> {
    loop {
        if let Some(status) = group.child_mut().try_wait()? {
            return Ok(status);
        }
        if cancelled() || deadline.is_some_and(|d| Instant::now() >= d) {
            group.kill();
            return Err(io::Error::new(io::ErrorKind::Interrupted, "arrêt demandé"));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Sortie complète d'une commande.
pub struct Collected {
    pub outcome: Outcome,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

/// Exécute `command` et en recueille **toute** la sortie standard (jusqu'à
/// `max_stdout` octets) : pour du JSON d'une seule ligne, que `run_streaming`
/// tronquerait. La sortie d'erreur est conservée par lignes.
pub fn run_collect(
    command: &mut Command,
    timeout: Option<Duration>,
    cancelled: &dyn Fn() -> bool,
    max_stdout: usize,
) -> io::Result<Collected> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut group = Group::spawn(command)?;
    let out = group.child_mut().stdout.take();
    let err = group.child_mut().stderr.take();

    let out_thread = std::thread::spawn(move || {
        let mut collected = Vec::new();
        if let Some(mut out) = out {
            let _ = out.by_ref().take(max_stdout as u64 + 1).read_to_end(&mut collected);
            // Au-delà de la limite, on vide le tuyau : l'enfant ne doit jamais
            // se bloquer en écriture.
            let _ = io::copy(&mut out, &mut io::sink());
        }
        collected
    });
    let err_thread = std::thread::spawn(move || {
        let mut collected = String::new();
        if let Some(mut err) = err {
            let mut buffer = Vec::new();
            let _ = err.by_ref().take(256 * 1024).read_to_end(&mut buffer);
            collected = String::from_utf8_lossy(&buffer).to_string();
            let _ = io::copy(&mut err, &mut io::sink());
        }
        collected
    });

    let deadline = timeout.map(|t| Instant::now() + t);
    let outcome = loop {
        if let Some(status) = group.child_mut().try_wait()? {
            break Outcome::Exited(status);
        }
        if cancelled() {
            group.kill();
            break Outcome::Cancelled;
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            group.kill();
            break Outcome::TimedOut;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut stdout = out_thread.join().unwrap_or_default();
    stdout.truncate(max_stdout);
    Ok(Collected { outcome, stdout, stderr: err_thread.join().unwrap_or_default() })
}

/// Exécute une commande courte et rend sa sortie standard (avec délai).
pub fn capture(command: &mut Command, timeout: Duration) -> io::Result<(ExitStatus, String)> {
    let mut stdout = String::new();
    let outcome = run_streaming(command, Some(timeout), &|| false, &mut |stream, line| {
        if stream == Stream::Stdout {
            stdout.push_str(line);
            stdout.push('\n');
        }
    })?;
    match outcome {
        Outcome::Exited(status) => Ok((status, stdout)),
        _ => Err(io::Error::new(io::ErrorKind::TimedOut, "délai dépassé")),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::*;

    #[cfg(unix)]
    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    #[cfg(unix)]
    fn cancelling_kills_grandchildren_too() {
        // Le shell lance un « sleep » en arrière-plan puis attend : sans
        // groupe, tuer le shell laisserait ce sleep orphelin.
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 60 & echo $!; wait"]);
        let stop = Arc::new(AtomicBool::new(false));
        let remote = stop.clone();
        let mut grandchild: Option<i32> = None;
        let outcome = run_streaming(&mut command, None, &|| stop.load(Ordering::SeqCst), &mut |stream, line| {
            if stream == Stream::Stdout {
                grandchild = line.trim().parse().ok();
                remote.store(true, Ordering::SeqCst);
            }
        })
        .unwrap();
        assert!(matches!(outcome, Outcome::Cancelled), "{outcome:?}");
        let pid = grandchild.expect("pid du petit-enfant");
        // Le noyau met un instant à récolter le processus abattu.
        let deadline = Instant::now() + Duration::from_secs(3);
        while alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(pid), "le petit-enfant {pid} est resté en vie");
    }

    #[test]
    fn relays_lines_ended_by_newline_or_carriage_return() {
        let mut command = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo un& echo deux"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "printf 'un\\rdeux\\ntrois'; echo err >&2"]);
            c
        };
        let mut lines = Vec::new();
        let outcome = run_streaming(&mut command, None, &|| false, &mut |s, l| lines.push((s, l.trim().to_string()))).unwrap();
        assert!(matches!(outcome, Outcome::Exited(status) if status.success()));
        let out: Vec<_> = lines.iter().filter(|(s, _)| *s == Stream::Stdout).map(|(_, l)| l.as_str()).collect();
        if cfg!(windows) {
            assert_eq!(out, vec!["un", "deux"]);
        } else {
            assert_eq!(out, vec!["un", "deux", "trois"]);
            assert!(lines.iter().any(|(s, l)| *s == Stream::Stderr && l == "err"));
        }
    }

    #[test]
    fn a_timeout_kills_the_group() {
        let mut command = if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        let started = Instant::now();
        let outcome = run_streaming(&mut command, Some(Duration::from_millis(300)), &|| false, &mut |_, _| {}).unwrap();
        assert!(matches!(outcome, Outcome::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_missing_program_is_an_error_not_a_panic() {
        let mut command = Command::new("programme-qui-n-existe-pas-fourtout");
        assert!(run_streaming(&mut command, None, &|| false, &mut |_, _| {}).is_err());
    }

    #[test]
    fn arguments_are_never_interpreted_by_a_shell() {
        // Une valeur pleine de métacaractères reste une valeur.
        if cfg!(windows) {
            return;
        }
        let mut command = Command::new("echo");
        command.arg("$(whoami); `id` && rm -rf / | cat > /tmp/x");
        let (status, out) = capture(&mut command, Duration::from_secs(5)).unwrap();
        assert!(status.success());
        assert_eq!(out.trim(), "$(whoami); `id` && rm -rf / | cat > /tmp/x");
    }
}
