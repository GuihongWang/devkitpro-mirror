---
title: "Getting Started"
original_url: "https://devkitpro.org/wiki/Getting%20Started"
scraped_at: "2026-08-30T03:32:45.755Z"
---
## Contents

-   [1 Setup](#Setup)
    -   [1.1 Windows](#Windows)
    -   [1.2 macOS](#macOS)
    -   [1.3 Unix-like platforms](#Unix-like_platforms)
    -   [1.4 buildscripts](#buildscripts)

# Setup\[[edit](https://devkitpro.org/w/index.php?title=Getting_Started&action=edit&section=1)\]

devkitPro currently provide 3 toolchains, devkitARM, devkitPPC and devkitA64 along with a number of support libraries. All of them are managed via pacman.

***Please note: devkitPro is the organisation that provides the tools. We are not a software package, we don't have version numbers and the only way to have us compile your code is to pay us (or maybe if you ask nicely when you need help figuring out an issue)***

On Windows, there's a [graphical installer](https://github.com/devkitPro/installer/releases/latest). On Unix-like platforms such as Linux/macOS, there's [devkitPro pacman](https://devkitpro.org/wiki/devkitPro_pacman).

## Windows\[[edit](https://devkitpro.org/w/index.php?title=Getting_Started&action=edit&section=2)\]

-   If you already use msys2 then you can follow the instructions at [https://devkitpro.org/wiki/devkitPro\_pacman](https://devkitpro.org/wiki/devkitPro_pacman) to add the devkitPro repositories.

Otherwise

-   [download the latest version of the graphical installer](https://github.com/devkitPro/installer/releases) from github and run it, following the instructions as you go.
-   An Internet connection is required.
-   Once the installer has finished, launch MSYS from:
    -   Windows 7 and earlier: Start -> All Programs -> devkitPro -> MSYS
    -   Windows 8 and 8.1: Right click on the Start screen and select 'All Apps'. You should find MSYS there.
    -   Windows 10 (pre-Anniversary Update): Start -> All Apps -> devkitPro -> MSYS
    -   Windows 10 (post-Anniversary Update): Start -> devkitPro -> MSYS

## macOS\[[edit](https://devkitpro.org/w/index.php?title=Getting_Started&action=edit&section=3)\]

-   To get the Xcode command line tools run \`xcode-select --install\` from Terminal.
-   Use the [pkg installer](https://github.com/devkitPro/pacman/releases/latest) to install [devkitPro pacman](https://devkitpro.org/wiki/devkitPro_pacman).
-   Reboot your mac to get environment set.
-   Use dkp-pacman to install your chosen tools as per Unix like platforms below.

## Unix-like platforms\[[edit](https://devkitpro.org/w/index.php?title=Getting_Started&action=edit&section=4)\]

-   Follow the instructions to install pacman found at [https://devkitpro.org/wiki/devkitPro\_pacman](https://devkitpro.org/wiki/devkitPro_pacman)
-   run sudo (dkp-)pacman -S <console>-dev to install the tools and libraries for each console you wish to develop for. Groups currently available are :-
    -   gba-dev
    -   gp32-dev
    -   nds-dev
    -   3ds-dev
    -   gamecube-dev
    -   wii-dev
    -   wiiu-dev
    -   switch-dev
-   If you're using a bash shell logout and login again to get the environment settings needed, otherwise check /etc/profile.d/devkit-env.sh and set the variables for your chosen shell.

## buildscripts\[[edit](https://devkitpro.org/w/index.php?title=Getting_Started&action=edit&section=5)\]

Where possible you should stick to the binary distributions - building from source can be a path of frustration even for seasoned developers. Where a binary is not provided then you should use the most recent stable release of the [https://github.com/devkitPro/buildscripts/releases/latest](https://github.com/devkitPro/buildscripts/releases/latest) buildscripts\]. The buildscripts in the git repositories should be avoided since the buildscripts found there will often contain the next iteration of a given toolchain rather than the current stable release and may only be usable by our developers. Using these scripts is a simple matter of extracting the archive, running ./build-devkit.sh from a bash shell and following the prompts. The scripts will also build and install the current support libraries from the release tarballs. The readme supplied with the buildscripts details some dependencies which need to be in place before starting a build. Please do not distribute the binaries you obtain that way or recommend that people do this instead of using pacman.
