use launcher_core::{LauncherIdentity, LauncherPathLayout, Namespace, ReleaseChannel};
use launcher_platform::default_data_root;
use std::error::Error;
use std::path::PathBuf;
use std::str::FromStr;

const DEFAULT_CHANNEL: ReleaseChannel = ReleaseChannel::Stable;
const DEFAULT_NAMESPACE: &str = "default";

#[derive(Debug, Eq, PartialEq)]
enum CommandMode {
    PrintPaths,
    Version,
}

#[derive(Debug)]
struct CliOptions {
    channel: ReleaseChannel,
    data_root: Option<PathBuf>,
    json: bool,
    mode: CommandMode,
    namespace: Namespace,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("open-design-launcher: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let options = parse_args(std::env::args().skip(1))?;
    match options.mode {
        CommandMode::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
        }
        CommandMode::PrintPaths => {
            let data_root = match options.data_root {
                Some(path) => path,
                None => default_data_root()?,
            };
            let identity = LauncherIdentity::new(options.channel, options.namespace);
            let paths = LauncherPathLayout::from_data_root(data_root, &identity);
            if options.json {
                println!("{}", serde_json::to_string_pretty(&paths)?);
            } else {
                println!("channelRoot={}", paths.channel_root.display());
                println!("namespaceRoot={}", paths.namespace_root.display());
                println!("stateRoot={}", paths.state_root.display());
                println!("versionsRoot={}", paths.versions_root.display());
                println!("updatesRoot={}", paths.updates_root.display());
            }
        }
    }
    Ok(())
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<CliOptions, Box<dyn Error>> {
    let mut channel = DEFAULT_CHANNEL;
    let mut data_root = None;
    let mut json = false;
    let mut mode = None;
    let mut namespace = Namespace::new(DEFAULT_NAMESPACE)?;
    let mut iter = args.into_iter();

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--channel" => {
                channel = ReleaseChannel::from_str(&take_value(&mut iter, "--channel")?)?;
            }
            "--data-root" => {
                data_root = Some(PathBuf::from(take_value(&mut iter, "--data-root")?));
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--json" => {
                json = true;
            }
            "--namespace" => {
                namespace = Namespace::new(take_value(&mut iter, "--namespace")?)?;
            }
            "--print-paths" => {
                mode = Some(CommandMode::PrintPaths);
            }
            "--version" | "-V" => {
                mode = Some(CommandMode::Version);
            }
            _ if arg.starts_with("--channel=") => {
                channel = ReleaseChannel::from_str(value_after_equals(&arg, "--channel="))?;
            }
            _ if arg.starts_with("--data-root=") => {
                data_root = Some(PathBuf::from(value_after_equals(&arg, "--data-root=")));
            }
            _ if arg.starts_with("--namespace=") => {
                namespace = Namespace::new(value_after_equals(&arg, "--namespace="))?;
            }
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }

    Ok(CliOptions {
        channel,
        data_root,
        json,
        mode: mode.ok_or("expected --print-paths or --version")?,
        namespace,
    })
}

fn take_value(
    iter: &mut impl Iterator<Item = String>,
    flag: &'static str,
) -> Result<String, Box<dyn Error>> {
    iter.next()
        .ok_or_else(|| format!("{flag} requires a value").into())
}

fn value_after_equals<'a>(arg: &'a str, prefix: &'static str) -> &'a str {
    &arg[prefix.len()..]
}

fn print_help() {
    println!(
        "Usage:
  open-design-launcher --version
  open-design-launcher --print-paths [--json] [--channel <stable|beta|nightly|preview>] [--namespace <name>] [--data-root <path>]"
    );
}
