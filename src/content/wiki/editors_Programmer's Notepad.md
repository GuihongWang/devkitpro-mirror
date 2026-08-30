---
title: "editors/Programmer&#039;s Notepad"
original_url: "https://devkitpro.org/wiki/editors%2FProgrammer's%20Notepad"
scraped_at: "2026-08-30T03:34:14.260Z"
---
The devkitPro windows installer provides a lightweight code editor called [Programmer's Notepad](http://www.pnotepad.org/), already configured for running make and capturing error output. You are, of course, free to use the command line if that's how you prefer to work but you'll be much more productive with PN2 or a similarly capable editor.

We intend to change the supplied editor to CodeLite - PN2 is quite cabable but is unfortunately windows only.

Most of the example code provided contains a .pnproj file. Double clicking this file should load the relevant project complete with file tree view. Some tools are configured already - make and clean, these may be accessed by pressing ALT 1 for make and ALT 2 for clean or alternatively from the tools menu. The project files are designed so that .h files saved in the include folder and .c/.cpp files saved in the source folder are automatically added to the tree view. To get files which have just been added to show up you need to toggle the relevant folder in the tree view.

**When creating your own projects copy the example you're working from to a new folder outside the devkitPro folder. The installer/updater will remove everything in the examples folders when new samples are provided**

In order to set these functions up manually first click Tools->options then move to the Tools pane in the options dialog. In this section you want to modify the global tools.

[![](https://devkitpro.org/w/images/4/47/pnoptions.png)](https://devkitpro.org/wiki/File:pnoptions.png)

Click the add button and set up make as shown here. The command is the actual command line used to run the tool, in this case simply make. The Folder box denotes the working directory for the tool, in this case we've set it to $(ProjectPath) which is the directory where the PN2 project file is stored. All the devkitPro example code is arranged so the makefile is there. Set the tool to save all files before running so you don't have to save your modifications manually. To set the keyboard shortcut for the tool simply click in the Shortcut box and press your desired key combination.

[![](https://devkitpro.org/w/images/f/f8/pntooltoolprops.png)](https://devkitpro.org/wiki/File:pntooltoolprops.png)

Click the Console I/O tab and tick the Capture Output box, the default error parser is fine for gcc tools.

[![](https://devkitpro.org/w/images/9/9b/pntooltoolio.png)](https://devkitpro.org/wiki/File:pntooltoolio.png)

Setting up clean is identical, just set the name of the tool as 'clean' and the command as 'make clean'.
