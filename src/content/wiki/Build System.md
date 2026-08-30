---
title: "Build System"
original_url: "https://devkitpro.org/wiki/Build%20System"
scraped_at: "2026-08-30T03:32:42.854Z"
---
One of the great features of the devkitPro toolchains is the project build system we designed to encourage users towards the delights of GNU make and away from the horrible windows batch files once prevalent amongst homebrew programmers. This system was based largely around the work of Paul Smith over at [make.paulandlesley.org](http://make.paulandlesley.org/), specifically the article on [Advanced Auto Dependency Generation](http://make.paulandlesley.org/autodep.html).

All the example code and templates for devkitARM, devkitPPC and devkitA64 contain makefiles which expect the project to contain particular folders and allow the user to add source files with minimal makefile editing.

The basic layout for a project is as follows.

```
 myproject       main project folder
   |
   +-- source    source files for the build - .c, .cpp, .s etc
   |
   +-- include   public header files, normally used when building libraries
   |
   +-- data      used for embedded binary data to link with the project
   |
   +-- build     output directory for object files, created automatically

```

Within the Makefiles provided by the templates you'll see several variables you can change for your own projects.

```
#---------------------------------------------------------------------------------
# TARGET is the name of the output
# BUILD is the directory where object files & intermediate files will be placed
# SOURCES is a list of directories containing source code
# INCLUDES is a list of directories containing extra header files
#---------------------------------------------------------------------------------
TARGET		:=	$(notdir $(CURDIR))
BUILD		:=	build
SOURCES		:=	source
INCLUDES	:=	include
DATA		:=	data

```

The TARGET variable specifies the name of the output file and the appropriate extension will be added by the Makefile ( .gba, .nds, .dol ). Here we're using a default macro which uses the name of the folder containing the project, this allows the terminally lazy programmer to avoid having to edit the makefile to change the name of the target.

BUILD specifies the output folder where object and intermediate files will be stored during the build. This is created automatically during the build.

SOURCES is a list of space separated directories which will be searched for source files that will be automatically built and linked into the final binary. These directories are relative to the folder containing the Makefile.

INCLUDES is a list of directories containing header files for the project and, like SOURCES, these are relative to the Makefile.

DATA is used to specify directories containing binary data which will be directly linked to the project. Like the other variables these are relative to the Makefile but things are not quite as automatic, you'll need to add some rules to the makefile in order to tell the build system what to do with the data.

Towards the bottom of the makefile you'll see a block like this

```
#---------------------------------------------------------------------------------
# The bin2o rule should be copied and modified
# for each extension used in the data directories
#---------------------------------------------------------------------------------
#---------------------------------------------------------------------------------
# This rule links in binary data with the .bin extension
#---------------------------------------------------------------------------------
%.bin.o	:	%.bin
#---------------------------------------------------------------------------------
	@echo $(notdir $<)
	@$(bin2o)

```

This rule works in combination with the Makefile commands that search the data directories and uses the bin2o macro defined in the rules files for the toolchains. The macro runs a utility that converts the data to assembly source code which is then piped through the assembler to produce an object file. The macro also generates a header which is used to access the data from your code.

For a file called data.bin found in the data directory that header will be named data\_bin.h which defines data\_bin as your data array and data\_bin\_size as the size of the data you linked.

For other extensions you want to embed in your application simply copy & paste this rule block then change the .bin parts to your extension. As an example you could handle .bmp files in the data directory like this

```
#---------------------------------------------------------------------------------
%.bmp.o	:	%.bmp
#---------------------------------------------------------------------------------
	@echo $(notdir $<)
	@$(bin2o)

```

Several of the provided examples embed data using this method so have a look through those for more details.
