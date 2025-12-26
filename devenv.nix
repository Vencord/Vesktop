{
  pkgs,
  lib,
  config,
  ...
}:
{
  # https://devenv.sh/languages/
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs;
    pnpm.enable = true;
  };

  # See full reference at https://devenv.sh/reference/options/
}
