//! Localisation des exécutables du système.
//!
//! Un seul endroit, parce que la question a déjà coûté deux fois le même bug :
//! **le chemin rendu doit être lançable par `std::process::Command`**, et pas
//! seulement lisible par un humain.
//!
//! La méthode naïve est de demander au shell : `sh -c 'command -v ffmpeg'`.
//! Elle répond correctement sur Fedora. Sous Windows, le `sh` que fournit Git
//! rend une route MSYS — « /c/ProgramData/chocolatey/bin/ffmpeg » — que l'API
//! Win32 ne sait pas ouvrir : le lancement échoue en `ERROR_PATH_NOT_FOUND`
//! (code 3) parce que le répertoire `/c` n'existe pas. L'équivalent côté Node
//! a déjà été corrigé dans `scripts/lib/which.mjs` en interrogeant `where`.
//!
//! Ici, on ne consulte aucun shell : on lit `PATH` et on construit le chemin
//! soi-même. Il est natif par construction sur les deux systèmes, et la
//! recherche ne dépend ni de Git Bash, ni de `where`, ni d'un sous-processus.

use std::path::PathBuf;

/// Nom de fichier d'un exécutable sur la plateforme courante.
pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Cherche un exécutable dans le `PATH` et rend un chemin **lançable**.
///
/// Rend `None` si l'outil est absent : les appelants s'en servent pour ignorer
/// proprement ce qui en dépend.
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let file = exe(name);
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(&file)).find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn adds_the_windows_suffix_only_on_windows() {
        assert_eq!(exe("ffmpeg"), if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    }

    #[test]
    fn an_absent_tool_is_an_absence_not_a_wrong_path() {
        assert_eq!(find_in_path("outil-qui-n-existe-pas-fourtout"), None);
    }

    /// Le seul contrat qui compte : ce que la recherche rend se lance.
    ///
    /// C'est précisément ce que l'ancienne résolution par `sh -c 'command -v'`
    /// ne garantissait pas sous Windows — elle rendait un chemin d'apparence
    /// valide que `Command` refusait ensuite d'ouvrir. On le vérifie sur
    /// `cargo`, présent partout où ce test peut tourner.
    #[test]
    fn what_it_finds_can_actually_be_spawned() {
        let cargo = find_in_path("cargo").expect("cargo est dans le PATH d'un test cargo");
        assert!(cargo.is_absolute(), "chemin non absolu : {}", cargo.display());
        let output = Command::new(&cargo)
            .arg("--version")
            .output()
            .unwrap_or_else(|error| panic!("{} ne se lance pas : {error:?}", cargo.display()));
        assert!(output.status.success(), "{} --version a échoué", cargo.display());
    }
}
