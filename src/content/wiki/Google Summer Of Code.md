---
title: "Google Summer Of Code"
original_url: "https://devkitpro.org/wiki/Google%20Summer%20Of%20Code"
scraped_at: "2026-08-30T03:33:02.623Z"
---
## Contents

-   [1 Summer of Code](#Summer_of_Code)
-   [2 Mentors](#Mentors)
-   [3 Overall Expectations and Goals](#Overall_Expectations_and_Goals)
-   [4 Project Ideas](#Project_Ideas)
    -   [4.1 Beginner-Friendly Ideas](#Beginner-Friendly_Ideas)
        -   [4.1.1 Create Game Resource Editor/Manager](#Create_Game_Resource_Editor/Manager)
        -   [4.1.2 Sprite editor](#Sprite_editor)
    -   [4.2 Novice Ideas](#Novice_Ideas)
        -   [4.2.1 ndstool enhancements](#ndstool_enhancements)
        -   [4.2.2 Online Homebrew Catalog](#Online_Homebrew_Catalog)
    -   [4.3 Intermediate Ideas](#Intermediate_Ideas)
        -   [4.3.1 Refactor GameCube and Wii SDL ports](#Refactor_GameCube_and_Wii_SDL_ports)
        -   [4.3.2 3D model export/conversion tools](#3D_model_export/conversion_tools)
        -   [4.3.3 Cross-platform 3D/game framework](#Cross-platform_3D/game_framework)
        -   [4.3.4 Sound framework](#Sound_framework)
    -   [4.4 Advanced Ideas](#Advanced_Ideas)
        -   [4.4.1 GDB stub and host proxy](#GDB_stub_and_host_proxy)
        -   [4.4.2 Wii U Homebrew](#Wii_U_Homebrew)
    -   [4.5 Note](#Note)

# Summer of Code\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=1)\]

devkitPro is the provider and maintainer of toolchains and libraries of choice for (homebrew) game development, currently available for Nintendo's GameBoy Advance, DS, 3DS, GameCube, Wii, WiiU and Switch as well as the Gamepark GP32.

There are currently three sets of toolchains--

-   devkitARM for the 3DS, DS, GBA, and GP32
-   devkitPPC for GameCube, Wii, and Wii U
-   devkitA64 for Switch

Further information and discussion of these toolchains can be found in the devkitPro forums, located at [http://devkitpro.org](http://forums.devkitpro.org), and additionally there are several IRC channels dedicated to homebrew development:

-   #dsdev and #wiidev on irc.blitzed.org.
-   #switchdev and #3dsdev on irc.efnet.org.

devkitPro is applying to become a mentoring organization for the 2019 Google Summer of Code. You can find more information about GSoC 2019 at the [GSoC page](https://summerofcode.withgoogle.com).

# Mentors\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=2)\]

A list of mentors is available on the [mentors page](http://devkitpro.org/wiki/Google_Summer_Of_Code/mentors). Our goal is to pair mentors with students based on which project idea the student would like to tackle, and so that the particular strengths and weaknesses of each mentor and student will balance out and create a strong bond.

# Overall Expectations and Goals\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=3)\]

Our organizational goal in participating in the Google Summer of Code is to encourage growth and community contribution for devkitPro, the toolchains and the support libraries, and to better support our end users. For students, we hope to increase your skills and give you experience working on a large project, while not totally drowning you in responsibility or isolating you from help.

We have split our project ideas into four categories, based on difficulty. If you aren't sure if you can tackle one of the more difficult ones, it may be in your best interests to pick a less challenging idea, but we will support whatever you think you can handle. Please feel free to hop on irc ([blitzed/#devkitPro](irc://irc.blitzed.org/#devkitPro)) and have a chat with one of the mentors if you need help deciding (or for any reason, really. we won't bite!)

For all of these projects, we'd like to emphasize not just programming skill, but also design, planning, and documentation. At the very least, we expect you to follow good programming practices, but in addition we'd like to see good inline comments as well as end-user documentation, tutorials, and sample code where applicable. It is just as important to learn good documenting as it is to learn good programming--it often does not matter as much who has the better solution, as much as it matters who can explain it better.

# Project Ideas\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=4)\]

Potential projects that would benefit the homebrew scene in general. Please note that this list is not exclusive; if you have something you want to do, please please feel free to apply to do it and we will assign an appropriate mentor to you.

## Beginner-Friendly Ideas\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=5)\]

These are ideas that are probably best for someone who hasn't worked on a project with other people before, and may need a higher degree of assistance. These may require less programming than other ideas, but are still very useful.

### Create Game Resource Editor/Manager\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=6)\]

There is a definite need for a free, open source "map editor" for creating and managing tile/game maps for tile based games. Most GBA and Many NDS games are tile based, or at least have tile based components.

-   We'd like to see this be cross-platform utility
-   Initially, we would like a tile/map editor that supports several layers and optimizing tiles
-   A long term goal of this project is to provide a means to organize and manipulate all common game resources. It would be beneficial if it also could work with and manage graphics objects (such as sprites and other non animated objects), strings and scripts, music files, and general data files. Being able to group these things and define rules for conversion as well as provide a means for integration into the build process is a more complex problem.

Skills:

-   Qt/wxWidgets
-   Image Processing
-   Documentation Skills
-   UI Skills

### Sprite editor\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=7)\]

It would be great if we had a cross-platform sprite editor.

-   This is listed as a separate idea, for reasons of scope. It is recommended/preferred this be an addon or be worked on with addition to the game resource editor, but that is not mandatory.

Skills:

-   Programming (Same language as above if an addon)
-   UI Design
-   Image Manipulation

## Novice Ideas\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=8)\]

### ndstool enhancements\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=9)\]

ndstool is the application which builds a .nds file from its component parts - the arm7 & arm9 binaries, icons, banner text and the embedded filesystem.

Currently it cannot edit an existing file without first extracting the indvidual parts. There was also a feature request asking for separate banner & banner text manipulation.

-   possible rewrite, with the objective to allow editing as well as extraction & creation.
-   ground-up rewrite utilizing OOP would be great
-   support existing command line arguments

Skills:

-   C/C++
-   binary file manipulation

### Online Homebrew Catalog\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=10)\]

This would be browsable from the 3DS and Switch's Homebrew Menus, as well as the web. Amateur developers would be able to upload games and applications for peer review which would then be accessible in the catalog. Support for more consoles could also be added as needed.

-   This would be similar in functionality to app stores and other software distribution channels.

Skills:

-   Web development
-   C/C++
-   Good UI design

## Intermediate Ideas\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=11)\]

### Refactor GameCube and Wii SDL ports\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=12)\]

SDL ports already exists but use custom makefiles rather than the existing configure system. It also converts from RGB to the wii/cube YCbCr framebuffer in software where using the 3D hardware would make more sense. We'd like these refactored and packaged for use with our pacman installer.

Skills:

-   C/C++
-   Autotools

### 3D model export/conversion tools\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=13)\]

We need a standardized way of getting 3D models and textures from modeling applications into a format which is easily usable on the 3DS, Switch, NDS, Gamecube and Wii. Currently everyone who wants to write 3D applications has to either hobble along with partially working tools, or write their own from scratch. Having a full-featured, highly-compatible conversion/export tool would make 3D development accessible to many more people. Some work has been done on a collada parser which could be provided as a starting point.

-   ability to read 3d models (mesh, bone, texture, etc) from programs such as Blender, LightWave, Milkshape
-   Wings3D, Maya, 3dsMAX, and other support if time permits
-   define a standard model format for NDS/GC/Wii and allow export to this format
-   sample code and documentation is a must

Skills:

-   3D Math
-   3D Math (really important!)

### Cross-platform 3D/game framework\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=14)\]

In relation to the previous idea, it would be good to create a lightweight 3D/game framework that would allow developers to write 3D games and applications running on 3DS and Switch (and possibly Wii or Wii U). It would tie in with the 3D model conversion tool, and would abstract the differences between the 3DS' citro3d and the Switch's OpenGL interface.

-   Write a framework in C/C++
-   Write additional tools for producing resources

Skills:

-   Experience with existing frameworks such as Unity
-   3D Math (can't stress this enough!)

### Sound framework\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=15)\]

Silent games are no fun. For that reason, we need an easy to use sound system. On DS/GBA there's Maxmod; however on 3DS and Switch we have no such library. Ideally, this library would allow playback of sequenced music (with soundfonts), streamed music and perhaps even tracked music as well; and the library would take advantage of the 3DS and Switch's DSP-powered hardware mixing capabilities.

-   Write a sound system library
-   Write tools needed to produce and convert sound content

Skills:

-   Audio programming
-   ADSR/envelopes
-   Audio theory
-   Digital signal processing (DSP), especially filters

## Advanced Ideas\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=16)\]

Up for a challenge? These ideas are things we'd really like to see done, but feel that their scope or difficulty may lay outside of what can be accomplished during the GSoC. That said, you don't have to stop when the GSoC is over, and these would make great projects for some.

### GDB stub and host proxy\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=17)\]

For GBA, there was a device called Xboo which allowed for hardware debugging. No such device has been developed for the Nintendo DS If developed, this would allow developers to debug their applications on the target platform via a stub which communicates with GDB (GNU Debugger) running on a host PC. Being able to debug on hardware is very valuable, since currently all PC-based emulators are either lacking debug capability or lacking in emulation accuracy.

-   Create hardware (or possibly wifi) debugging interface for Nintendo DS
-   Tie in to GDB

Skills:

-   Great knowledge of ARM Architecture
-   Knowledge of GDB/Insight
-   Some hardware design experience

### Wii U Homebrew\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=18)\]

Nintendo created an ill fated console many years ago, the Nintendo Wii U. Due to a lack of scene interest, there had never been proper fully integrated homebrew support in devkitPro's toolchains. However, recently a revival of Wii U homebrew is taking place and we're looking towards standardising development on the Wut library, as well as creating a clean and reliable homebrew execution environment through the help of a new and refactored "custom firmware" for the console as well as a redesigned Homebrew Menu on par with the ones available for other consoles.

-   Reverse engineer security mechanisms to find a way to inject or otherwise run homebrew code <ref>the DMCA allows software developers to circumvent technological protection measures of a lawfully obtained computer program in order "the elements necessary to achieve interoperability of an independently created computer program with other programs."</ref>

Skills:

-   Reverse engineering
-   PPC Assembly
-   Hardware/FGPA experience will help (for prototyping and intercepting data)

## Note\[[edit](https://devkitpro.org/w/index.php?title=Google_Summer_Of_Code&action=edit&section=19)\]

<references />
