---
title: "PAlib"
original_url: "https://devkitpro.org/wiki/PAlib"
scraped_at: "2026-08-30T03:34:00.242Z"
---
**If you're just getting started with NDS homebrew development then you should avoid PAlib, PAlib users and PAlib tutorials at all costs. They will give you bad advice and teach you programming methodologies which will hinder your progress and ensure that your projects are plagued with problems that will be nigh on impossible to fix.**

In the early days of Nintendo DS development, while libnds was still building the low level support code, a library appeared with the goal of making things easier for novice programmers. This library, called PAlib ( standing for Programmer's Arsenal ), set out to provide a comprehensive set of wrapper functions which would allow someone with only the most basic knowledge of programming to get the skeleton of a DS game up and running quickly.

Making the tools used for homebrew programming more accessible to a wider range of skillsets is a laudable goal - one that is shared wholeheartedly by devkitPro. Unfortunately PAlib was badly designed, made use of internal functions never intended for user code and didn't keep pace with development which has fixed several very nasty bugs over the years. It might seem easier to get up and running but problems are still being reported with SD card corruption, odd issues with flashcards and wifi connection problems that have all been resolved by not using PAlib wrappers for libnds code.

For this reason devkitPro will not provide support to users attempting to get PAlib working. If you have followed the instructions given on the PAlib site and other sites whose tools depend on PAlib then uninstall completely and start over from scratch without replacing the PAlib parts. This is the only way to avoid issues that have been long fixed.

At the time of writing we have plans to further improve the accessibility of the tools and libraries we release. Unfortunately it will not be possible to ensure that 3rd party releases remain compatible with our tools and the integrity of those tools will be placed in question if you install anything not released by devkitPro inside, or make modifications to, the file system provided by the automated installer.

If you require assistance with our tools then please use the [official support forums](http://forums.devkitpro.org) and the irc channels listed in the [Community Portal](https://devkitpro.org/wiki/Community_Portal) page.
