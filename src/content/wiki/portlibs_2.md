---
title: "portlibs"
original_url: "https://devkitpro.org/wiki/portlibs"
scraped_at: "2026-08-30T03:34:20.660Z"
---
devkitPro supply a selection of useful libraries for porting purposes which are all available via [devkitPro pacman](https://devkitpro.org/wiki/devkitPro_pacman).

To use these libraries in your projects you can mostly just add $(PORTLIBS) to the LIBDIRS line and the appropriate lib to the LIBS line in the template makefiles, the devkitPro build system takes care of the rest. Some libraries come with .pc files for pkg-config, others come with config scripts which may be found in the appropriate bin folder (/opt/devkitpro/portlibs/<platform>/bin).

For libraries which use a config script (i.e. freetype or sdl) you can add the appropriate incantations to the CFLAGS & LIBS lines like this :-

```
   CFLAGS	= <other cflags as appropriate> `freetype-config --cflags` `sdl-config --cflags`
   #---------------------------------------------------------------------------------
   # any extra libraries we wish to link with the project
   #---------------------------------------------------------------------------------
   LIBS	:=	`freetype-config --libs` <other libs as appropriate>

```

Similarly if a library has a .pc file (found in /opt/devkitpro/<platform>/lib/pkgconfig) you can use the appropriate pkg-config script found in /opt/devkitpro/portlibs/<platform>/bin. For instance devkitARM uses arm-none-eabi-pkg-config, devkitPPC uses powerpc-eabi-pkg-config & devkitA64 uses aarch64-none-elf-pkg-config. The stock Makefiles will have PREFIX set as appropriate.

```
   CFLAGS	= <other cflags as appropriate> `$(PREFIX_pkg-config <list of libraries> --cflags`
   #---------------------------------------------------------------------------------
   # any extra libraries we wish to link with the project
   #---------------------------------------------------------------------------------
   LIBS	:=	`$(PREFIX)pkg-config <list of libraries> --libs` <other libs as appropriate>

```

You can also list all the available libraries by calling the appropriate script directly like this

```
   /opt/devkitpro/portlibs/3ds/bin/arm-none-eabi-pkg-config --list-all

```

Again replace the path to <host>i-pkg-config as appropriate for other platforms.

**Note:** For this to work you'll need both your host pkg-config & the appropriate platform pkg-config installed. These will be installed as part of the appropriate dev group.

```
   (dkp-)pacman -Ss pkg-config
   dkp-libs/3ds-pkg-config 0.28-2
       pkg-config wrapper (for Nintendo 3DS homebrew development)
   dkp-libs/nds-pkg-config 0.28-2
       pkg-config wrapper (for Nintendo DS homebrew development)
   dkp-libs/ppc-pkg-config 0.28-3
       pkg-config wrapper (for Nintendo Gamecube/Wii homebrew development)
   dkp-libs/switch-pkg-config 0.28-2
       pkg-config wrapper (for Nintendo Switch homebrew development)
   dkp-libs/wiiu-pkg-config 0.28-2 (wiiu-dev)
       pkg-config wrapper (for Nintendo WiiU homebrew development)

```
