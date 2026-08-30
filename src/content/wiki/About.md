---
title: "About"
original_url: "https://devkitpro.org/wiki/About"
scraped_at: "2026-08-30T03:32:39.739Z"
---
devkitPro is an organisation dedicated to producing a number of cross compilers intended for use by hobby programmers writing their own games and applications for popular games consoles where it's possible to run unsigned code. The goal is to provide amateur programmers with the means to program for resource limited devices and so gain valuable experience which would transfer well to a career in game development.

Starting in 2003 with a cross compiler called devkitARM, used to write games for Nintendo's Gameboy Advance, devkitPro expanded to produce toolchains targeting GameCube, Wii , GP32, Nintendo DS, GP2X and Nintendo Switch.

devkitARM was the first toolchain and remains the most popular of our toolchains today. The toolchain has evolved over the years to support several ARM based consoles and is now one of the best windows based toolsets for working with ARM devices in general.

devkitPPC first arrived in early 2004 and later incorporated libogc which provides a multitasking microkernel and the most comprehensive access to the gamecube hardware currently available. In 2007, with the appearance of the Twilight Hack, it became possible to run code on the Wii which allowed us to update libogc to support that platform too.

In 2005 devkitPSP was added to the stable by popular request. In contrast to the other toolchains this one was merely a windows native toolchain which builds on the sterling work of the people over at ps2dev.org. Unfortunately time and resource constraints has meant we can no longer provide these binaries.

If you're thinking about using a devkitPro toolchain for a derivative product, i.e. placing a preinstalled toolchain in a VM image, creating software which uses one of our toolchains to build generated code or packaging our tools with your product in any way, please don't. See [Trademark Guidelines](http://devkitpro.org/wiki/Trademarks) for advice on our position. These kind of packages/products cause us endless support problems.

We do provide convenient docker images at [https://hub.docker.com/u/devkitpro/](https://hub.docker.com/u/devkitpro/) which may be used freely for continuous integration.
