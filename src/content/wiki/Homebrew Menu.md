---
title: "Homebrew Menu"
original_url: "https://devkitpro.org/wiki/Homebrew%20Menu"
scraped_at: "2026-08-30T03:33:16.788Z"
---
## Contents

-   [1 Introduction](#Introduction)
-   [2 Binaries](#Binaries)
-   [3 Source Code](#Source_Code)
-   [4 ARGV Protocol](#ARGV_Protocol)
-   [5 Exit to Menu Protocol](#Exit_to_Menu_Protocol)
-   [6 Cards that support the ARGV protocol](#Cards_that_support_the_ARGV_protocol)

## Introduction\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=1)\]

Unfortunately the vast majority of the cards we use to run homebrew applications are heavily biased towards commercial game piracy which means that we suffer from the fallout when Nintendo block these cards and have them removed from sale due to the focus on copyright infringement. In recent months Nintendo's anti-piracy tactics have become more aggressive resulting in custodial sentences for several suppliers of DS flashcards.

The Homebrew Menu is a simple launcher intended to support DS homebrew developers and their users which has no means to run commercial games. This takes the focus away from copyright infringement and into the legal protection of reverse engineering for interoperability purposes provided by the DMCA and EUCD. Currently devkitPro is researching the feasibility of a branded flashcard without piracy features which should hopefully preserve our ability to create and share homebrew. This menu also supports two features thus far ignored by the pirate cards, argv support and a standard exit to menu method.

Some cards appear to have built their dldi code using arm946e-s specific code and unfortunately these cards will fail since hbmenu runs the nds launching code on the arm7. We do this to make sure that we can load and launch an nds file which uses all available memory on both processors - cards which don't will place unnecessary limits on the size of homebrew applications.

## Binaries\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=2)\]

The current binaries, which include bootstrap code that can be used to completely replace the menu on R4, ezflash V and AceKard 2(i), can be downloaded from the devkitPro github repository - [https://github.com/devkitPro/nds-hb-menu/releases/latest](https://github.com/devkitPro/nds-hb-menu/releases/latest)

## Source Code\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=3)\]

For users interested in how this works and card manufacturers who wish to support homebrew,the source may be obtained from the devkitPro github repository. Ideally any useful modifications should be contributed back to us so everyone benefits - forking and releasing custom versions creates confusion.

[https://github.com/devkitPro/nds-hb-menu](https://github.com/devkitPro/nds-hb-menu)

## ARGV Protocol\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=4)\]

All nds applications compiled with devkitARM r27+ will obtain an argv array from a supporting launcher which places the necessary values in an unused section of the DS header. A structure is provided for this in libnds, the launcher only needs to fill in argvMagic, command and length, all other values are generated internally during startup. The command line is a set of null terminated strings which is parsed and copied to the heap by the startup code.

```
// argv struct magic number
#define ARGV_MAGIC 0x5f617267

//!	argv structure
/*!	\struct __argv

	structure used to set up argc/argv on the DS

*/
struct __argv {
	int argvMagic;		//!< argv magic number, set to 0x5f617267 ('_arg') if valid
	char *commandLine;	//!< base address of command line, set of null terminated strings
	int length;		//!< total length of command line
	int argc;		//!< internal use, number of arguments
	char **argv;		//!< internal use, argv pointer
};

//!	Default location for the libnds argv structure.
#define __system_argv		((struct __argv *)0x02FFFE70)

```

This structure is for the use of launcher code and internal functions, user code should use the standard main signature

```
#include <nds.h>

int main( int argc, char **argv) {
	consoleDemoInit();
	if (0 != argc ) {
		int i;
		for (i=0; i<argc, i++ ) {
			if (argv[i]) printf("[%d] %s\n", i, argv[i]);
		}
	} else {
		printf("No arguments passed!\n");
	}

	do {
		scanKeys();
		int pressed = keysDown();
	} while (!(pressed & KEY_START));
	return 0;
}

```

## Exit to Menu Protocol\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=5)\]

From devkitARM r28 & libnds 1.4.1 nds applications can exit to the menu simply by returning from main or calling exit(0) but this also depends on support from the launcher. We reserve 48k at the top of main ram, 4k of system memory and 44k which the launcher can use for code to reload the menu - with hbmenu this is done by simply copying its own dldi patched launcher to the appropriate area with a small stub to copy it to VRAM and reboot the arm7. This could easily be used to load code from the card but bear in mind that this approach will make the menu less universal. There's a structure defined in libnds for use by launchers.

```

#define BOOTSIG	0x62757473746F6F62ULL

struct __bootstub {
	u64	bootsig;
	VoidFn arm9reboot;
	VoidFn arm7reboot;
	u32 bootsize;
};

```


Finding this structure in memory is done from the pointer to the end of RAM used to support newlib's malloc.

```
	extern char *fake_heap_end;
	struct __bootstub *bootcode = (struct __bootstub *)fake_heap_end;

	bootcode->bootsig = BOOTSIG;
	bootcode->arm9reboot = <function to reboot from arm9>
	bootcode->arm7reboot = <function to reboot from arm7>

```

The functions should be placed in the 44k reserved region pointed to by fake\_heap\_end. Note: This address will be different depending on the DS version - DS Phat/Lite, DS debug version and DSi so use the pointer.

## Cards that support the ARGV protocol\[[edit](https://devkitpro.org/w/index.php?title=Homebrew_Menu&action=edit&section=6)\]

This is a list of cards that support the ARGV protocol, this list will be updated as soon as other cards are confirmed to support the ARGV / exit to menu functionality of libnds.

List of cards supporting the ARGV / Exit to menu protocols

Card name

ARGV Support

Exit to Menu Support

R4

HBMenu

HBMenu

Acekard 2/2i/RPG

Akaio 1.6

HBMenu

CycloDS

1.58 beta 2

Edge

Firmware 1.9
