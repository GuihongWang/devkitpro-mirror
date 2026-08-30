---
title: "devkitPro pacman"
original_url: "https://devkitpro.org/wiki/devkitPro%20pacman"
scraped_at: "2026-08-30T03:34:08.380Z"
---
## Contents

-   [1 Installing devkitPro Pacman](#Installing_devkitPro_Pacman)
-   [2 Customising Existing Pacman Install](#Customising_Existing_Pacman_Install)
    -   [2.1 Apine](#Apine)
    -   [2.2 Debian and derivatives](#Debian_and_derivatives)
    -   [2.3 Fedora](#Fedora)
    -   [2.4 Gentoo](#Gentoo)
    -   [2.5 macOS](#macOS)
    -   [2.6 openSUSE](#openSUSE)
    -   [2.7 Void Linux](#Void_Linux)
    -   [2.8 Windows](#Windows)
-   [3 Using Pacman](#Using_Pacman)
    -   [3.1 Updating Databases](#Updating_Databases)
    -   [3.2 Installing packages](#Installing_packages)
    -   [3.3 Predefined Groups](#Predefined_Groups)

## Installing devkitPro Pacman\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=1)\]

devkitPro provided tools and libraries are managed by the rather wonderful [Arch Linux pacman](https://wiki.archlinux.org/index.php/pacman). We provide [our own binaries](https://github.com/devkitPro/pacman/releases/latest) as .pkg for OSX and via our own apt repository for debian based linux distributions.

## Customising Existing Pacman Install\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=2)\]

**Note:** These instructions are for systems which come with pacman already installed i.e. Arch or Msys2. **Do Not** follow these instructions if you have dkp-pacman or used the devkitPro installer

For users already using a distro which provides pacman please follow these instructions. This also applies to Alpine, Fedora, Gentoo, and Void below as well as users who wish to use an existing msys2 install. If you're using a pre-existing msys2 install run the commands without sudo. Please also set environment variables as follows :-

```
   DEVKITPRO=/opt/devkitpro
   DEVKITARM=/opt/devkitpro/devkitARM
   DEVKITPPC=/opt/devkitpro/devkitPPC

```

Then import the key which is used to validate the packages. There seem to be issues with keyservers so we specify one here but you may need to look for a working one.

```
  sudo pacman-key --recv BC26F752D25B92CE272E0F44F7FD5492264BB9D0 --keyserver keyserver.ubuntu.com
  sudo pacman-key --lsign BC26F752D25B92CE272E0F44F7FD5492264BB9D0

```

Now install the devkitpro keyring. Msys2 users should ignore the sudo part - i.e. type the command line without sudo.

```
   sudo pacman -U https://pkg.devkitpro.org/devkitpro-keyring.pkg.tar.zst

```

On some systems there's an issue running the post install script resulting in an error message like \`call to execv failed (No such file or directory)\` so then if this happens then run

```
   sudo pacman-key --populate devkitpro

```

Add the devkitPro repositories. **Please note that you will require two - one for the libraries and another for the host specific tools.**

edit /etc/pacman.conf & add these lines

```
[dkp-libs]
Server = https://pkg.devkitpro.org/packages

```

for glibc base linux systems also add

```
[dkp-linux]
Server = https://pkg.devkitpro.org/packages/linux/$arch/

```

for musl based linux systems like Alpine and Void use this instead of dkp-linux

```
[dkp-linux-musl]
Server =  https://pkg.devkitpro.org/packages/linux-musl/$arch/

```

for existing msys2 systems use this one instead of dkp-linux above.

```
[dkp-windows]
Server = https://pkg.devkitpro.org/packages/windows/$arch/

```

Now resync the database and update installed packages.

```
    sudo pacman -Syu

```

### Apine\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=3)\]

On Alpine you can obtain pacman using the command **sudo apk install pacman** and edit the pacman configuration files as you would for Arch based linux distros and pre-existing msys2 installs. Run **pacman-key --init** then follow the [customising existing pacman instructions](https://devkitpro.org/wiki/devkitPro_pacman#Customising_Existing_Pacman_Install) above.

### Debian and derivatives\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=4)\]

On Debian based systems we have a script that sets up the repository for devkitPro pacman. You can simply download and run this but do please read the code for your own peace of mind.

```
   wget -U "dkp-apt" https://apt.devkitpro.org/install-devkitpro-pacman
   chmod +x ./install-devkitpro-pacman
   sudo ./install-devkitpro-pacman

```

The apt repository can also be used on WSL but you may need to make a symlink for /etc/mtab. See [https://github.com/Microsoft/WSL/issues/150](https://github.com/Microsoft/WSL/issues/150)

```
   sudo ln -s /proc/self/mounts /etc/mtab

```

Once you've done that then check out [Using Pacman](https://devkitpro.org/wiki/devkitPro_pacman#Using_Pacman) below.

### Fedora\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=5)\]

On Fedora you can obtain pacman using the command **sudo dnf install pacman** and edit the pacman configuration files as you would for Arch based linux distros , and pre-existing msys2 installs. Run **pacman-key --init** then follow the [customising existing pacman instructions](https://devkitpro.org/wiki/devkitPro_pacman#Customising_Existing_Pacman_Install) above.

### Gentoo\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=6)\]

Enable the gentoo-zh overlay:

```
   eselect repository enable gentoo-zh

```

Update repositories:

```
   emerge --sync

```

Install pacman: emerge --ask sys-apps/pacman

Note. The ~amd64 flag might need to be added to accept\_keywords for sys-apps/pacman, app-crypt/archlinux-keyring and sys-apps/pacman-mirrorlist

```
   echo "sys-apps/pacman ~amd64" > /etc/portage/package.accept_keywords/pacman
   echo "app-crypt/archlinux-keyring ~amd64" >> /etc/portage/package.accept_keywords/pacman
   echo "sys-apps/pacman-mirrorlist ~amd64" >> /etc/portage/package.accept_keywords/pacman

```

Optional (Recommended) Fetch the pacman mirrorlist:

```
   emerge --ask sys-apps/pacman-mirrorlist

```

Select mirrors or create the list from scratch:

```
   nano /etc/pacman.d/mirrorlist

```

Set up the keyring:

```
   pacman-key --init

```

In /etc/pacman.conf:

```
   nano /etc/pacman.conf

```

Set RootDir to root (/). The gentoo-zh pacman package recommends against this but it does not create any problems in our case as it will only be used to install dkP related packages. Comment out an XferCommand (either curl or wget). Proceed with the [customising existing pacman instructions](https://devkitpro.org/wiki/devkitPro_pacman#Customising_Existing_Pacman_Install) below.

### macOS\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=7)\]

On macOS run the .pkg installer from Terminal with

```
   sudo installer -pkg devkitpro-pacman-installer.pkg -target /

```

Then install the Xcode command line tools if you haven't already

```
   xcode-select --install

```

Reboot your mac to have ennviromnent variables set then then head to [Using Pacman](https://devkitpro.org/wiki/devkitPro_pacman#Using_Pacman) below.

### openSUSE\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=8)\]

On openSUSE you can obtain pacman through [Experimental or Community packages](https://software.opensuse.org/package/pacman) hosted on openSUSE Build Service. Pick the latest available version and install manually or by using [1 Click Install](https://en.opensuse.org/openSUSE:One_Click_Install) method. After installation you need to add alpm user by executing

```
   sudo useradd --system --no-create-home --home-dir / --shell /usr/sbin/nologin alpm

```

If successful, you'll see alpm user added in your passwd file

```
   # alpm:x:470:470::/:/usr/sbin/nologin
   cat /etc/passwd

```

Uncomment preferable server (e.g. first entry in Worldwide section) in **/etc/pacman.d/mirrorlist**

```
   ## Worldwide
   Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch

```

Run **pacman-key --init** then follow the [customising existing pacman instructions](https://devkitpro.org/wiki/devkitPro_pacman#Customising_Existing_Pacman_Install) above.

### Void Linux\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=9)\]

On Void you can obtain pacman using the command **sudo xbps-install -S pacman** and edit the pacman configuration files as you would for Arch based linux distros and pre-existing msys2 installs. Run **pacman-key --init** then follow the [customising existing pacman instructions](https://devkitpro.org/wiki/devkitPro_pacman#Customising_Existing_Pacman_Install) above.

### Windows\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=10)\]

We provide an [installer for 64bit windows](https://github.com/devkitPro/installer/releases/latest) which sets up a customised msys2 install already set up with the devkitPro packages.Unfortunately msys2 are no longer supporting 32bit and we advise moving to 64 bit if at all possible. You can still obtain the [32bit msys2 installer](http://repo.msys2.org/distrib/msys2-i686-latest.exe) and follow the manual instructions below.

## Using Pacman\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=11)\]

The customised pacman we ship for OSX and debian based distros is entirely self-contained within /opt/devkitpro/pacman. To avoid polluting the system and avoid clashes with system tools or games which may share the same name as pacman binaries we install helper scripts in /usr/local/bin which temporarily set path and forward to the custom binaries. **This means you substitute dkp-pacman for pacman on those systems. Do not add /opt/devkitpro/pacman/bin to your system path, this will cause issues.**

### Updating Databases\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=12)\]

To resync the databases before obtaining updates, this command is similar to **apt-get update**

```
   sudo (dkp-)pacman -Sy

```

To update installed packages, this command is similar to **apt-get upgrade**

```
   sudo (dkp-)pacman -Syu

```

### Installing packages\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=13)\]

You can list all available packages with

```
   (dkp)-pacman -Sl

```

To show only the libraries supplied by devkitPro append dkp-libs

```
   (dkp-)pacman -Sl dkp-libs

```

You can search for packages using

```
   (dkp-)pacman -Ss <search string>

```

### Predefined Groups\[[edit](https://devkitpro.org/w/index.php?title=devkitPro_pacman&action=edit&section=14)\]

We provide several convenient groups which may be installed using **sudo (dkp-)pacman -S <group name>**

```
- gp32-dev
- gp2x-dev
- gba-dev
- nds-dev
- 3ds-dev
- gamecube-dev
- wii-dev
- wiiu-dev
- switch-dev

```

To list packages use \`dkp-pacman -Sl\` To install a package use \`sudo dkp-pacman -S <name of package>\` \`sudo dkp-pacman -R <name of package>\` will remove an already installed package.
