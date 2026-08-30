---
title: "editors/CodeLite"
original_url: "https://devkitpro.org/wiki/editors%2FCodeLite"
scraped_at: "2026-08-30T03:34:09.910Z"
---
Eventually we intend to supply CodeLite as the editor of choice for the devkitPro toolchains. This is a really nice cross platform lightweight IDE with advanced features.

As it stands CodeLite needs a little bit of work before being bundled with the toolchains. Currently the template system flattens the project folder which breaks the layout of the devkitPro supplied templates so they won't work. For now we have a set of CodeLite template projects which you can use as a basis found [here](http://sourceforge.net/projects/devkitpro/files/misc/). Simply copy the appropriate folder for your chosen console target, add source files, edit the Makefile if necessary and build.
