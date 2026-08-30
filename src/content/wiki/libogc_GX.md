---
title: "libogc/GX"
original_url: "https://devkitpro.org/wiki/libogc%2FGX"
scraped_at: "2026-08-30T03:34:19.151Z"
---
**THIS ARTICLE IS A WORK IN PROGRESS AND IS CURRENTLY NOT TO BE CONSIDERED AN AUTHORITATIVE SOURCE OF INFORMATION. YOU HAVE BEEN WARNED.**

## Contents

-   [1 Preface](#Preface)
-   [2 GX Setup and Particulars](#GX_Setup_and_Particulars)
-   [3 Performance Optimization](#Performance_Optimization)
-   [4 Attribute Slots](#Attribute_Slots)
-   [5 Vertex Initialization](#Vertex_Initialization)
-   [6 Drawing Triangles](#Drawing_Triangles)
-   [7 Matrix Math](#Matrix_Math)
-   [8 Textures](#Textures)
-   [9 Lighting](#Lighting)

## Preface\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=1)\]

Some concepts in this article require some prerequisite knowledge about 3D programming in general, the GX API specifically or both. The NeHe OpenGL lessons are an excellent supplementary resource for learning the specifics of OpenGL and can work hand-in-hand with the OpenGL textbooks. libogc also has lessons 1 through 10 converted to the GX and gu APIs, so cross-referencing the source code for those lessons can help you understand at is going on.

You'll *definitely* need to have a handle on how to program in C, especially concerning things such as floating-point numbers and pointers, both of which are used heavily. The functions, compiler directives and other parts of the API are viewable in the Doxygen pages. Some functions have real documentation with them (the most often-used ones usually), but almost all of the GX Doxygen listings have no accompanying description, and you may find yourself having to wing it while learning and writing GX. If you get completely hung-up on how a particular function or block of functions affects the system, remember that Google is your friend; sometimes you can find the answer on the devkitpro forums (use site:forums.devkitpro.org in Google to search there); sometimes it can be found elsewhere (the wiibrew forums are sometimes useful, but avoid their wiki!), and sometimes you won't get any useful results at all. Hopefully, the Doxygen documentation will be expanded in time, but until then, you'll be put through a trial-by-fire.

This article was initially written by me, ccfreak2k. shagkur originally wrote most of the GX backend code in libogc, and as such could be considered the authority on the subject, but he has not been around for a while. As such, this article includes what I believe to be correct information, and is all the information I have compiled on the subject thus far. I have done my best to make sure that the information is as accurate as possible (since wrong information is worse than no information!). The examples provided with libogc are known to be correct implementations of GX, so defer to those if there's a conflict on how something works.

Most important of all, however, is that you **understand how your code works**. Becoming a [cargo cult programmer](http://en.wikipedia.org/wiki/Cargo_cult_programming) is a bad idea, so make the effort to understand what you're writing and why you're writing it.

## GX Setup and Particulars\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=2)\]

GX shares some similarities with OpenGL, and differs greatly in many ways as well. OpenGL, by design, masks a lot of the nitty-gritty hardware specifics, leaving implementation of it to hardware vendors, whereas the GX API is very close to the metal and many functions have little, if any, processing performed by the CPU. What this means is that, if you write smart code and know how the hardware works under the hood, you can bring out the best performance of the machine, but you'll also be working with an API that is altogether more complex than writing in a higher-level API such as OpenGL.

Before you start initializing GX, you'll want to make sure you have the VIDEO subsystem set up. Almost every GameCube application that displays *anything* will do this. This includes allocating framebuffers acquiring the TV screen attributes. Right after you have VIDEO set up is when you'll generally initialize GX.

To start, you'll need to allocate a "GP FIFO". The GP FIFO, or "graphics processor FIFO" is a portion of memory reserved for uploading commands to the GP. A FIFO is a type of pipe, but that's not necessary to know for now. To initialize the GX subsystem, you'll need to make some room for the FIFO, which you'll do like this:

`void *gp_fifo = NULL; gp_fifo = memalign(32,DEFAULT_FIFO_SIZE); memset(gp_fifo,0,DEFAULT_FIFO_SIZE);`

The FIFO must be 32-byte aligned, which is what memalign() does. It's like malloc(), except it gives us a block of memory aligned to whatever alignment we specify. We also give DEFAULT\_FIFO\_SIZE as the size of memory that we want. The size of the FIFO required generally depends on how many commands you're dispatching per unit of time, but the default size is adequate in many cases. memset() clears the FIFO memory to 0 because allocated memory is uninitialized, and we don't want the GP to mistake garbage for commands. With that out of the way, it's time to switch on GX:

`GX_Init(gp_fifo,DEFAULT_FIFO_SIZE);`

Here we give it a pointer to the FIFO and the size of the FIFO. From this point on, you probably won't be dealing with the FIFO anymore, as you'll be interfacing with the GP using the GX API now. What manner of initialization happens after this depends greatly on how you're using GX, but one function you'll generally use is this one:

`GXColor background = {0,0,0,0xff}; GX_SetCopyClear(background, 0x00ffffff);`

This tells the GP to clear the screen to the specified background color at the beginning of every new frame, which will eliminate the "hall of mirrors effect" that would happen otherwise.

What happens after this will generally mirror initialization in OpenGL with some big exceptions, which we'll discuss below.

## Performance Optimization\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=3)\]

There's many ways to optimize GX performance, usually dealing with redundant calls or eliminating calls if data between frames doesn't change (for example, you can save the view matrix after transformations and only create a new one if the viewpoint changes). One way you can optimize is by creating a separate thread for GX drawing operations. This can help if your other threads are almost always busy, such as if, for example, they're keeping track of the game state or managing AI. As soon as any thread is done with any work, it can put itself to sleep until new work can be done, which allows your other threads more CPU time to finish their work. How to use threading in libogc is not discussed here; however, here are some things to keep in mind if you decide to move your rendering code to a separate thread:

-   Use message passing to communicate render state changes. For example, if a new object needs to be rendered, use the message-passing interface of libogc to pass the pointer to the new object and have your rendering thread dereference it and read in the data, passing it to its drawing routines. Additionally, you can also use message passing to tell the render thread when an object should NOT be rendered anymore.

-   Use scheduling, sleep/wakeup and callbacks to your advantage. If your rendering thread is done with its drawing, it should sleep until the next frame. VIDEO\_WaitVSync() will put the calling thread in a wait state until the next vertical interrupt occurs, where it will then be woken up.

## Attribute Slots\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=4)\]

Many things in GX that can take different formats, such as vertex attributes or texture coordinate matrices, can be stored in slots. This lets you define all of your formats ahead of time and simply switch slots when required to load the stored formats. You're basically required to use at least one slot, even if you redefine the formats every time you change. You'll also find examples of slot usage peppered through this document and through example code, although I have yet to see any code that uses more than one slot. The biggest example involves the TEV, where you might have different settings for different textures, of which you can have eight textures per pass.

## Vertex Initialization\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=5)\]

One aspect of the close-to-the-hardware nature of GX is in vertex attributes. Before you start drawing triangles, you need to tell GX how they should be drawn. You'll generally do it like this:

`GX_InvVtxCache(); GX_ClearVtxDesc();  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT); GX_SetVtxDesc(GX_VA_NRM, GX_DIRECT); GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0); GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_NRM, GX_NRM_XYZ, GX_F32, 0); GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);`

GX\_InvVtxCache() tells the GP to invalidate the vertex cache. You'll do this at least once as part of initialization, but it might also useful if, you, for example, want to change the scene, which may involve having completely different objects to be drawn.

The calls to GX\_ClearVtxDesc() clears the vertex attribute table, which is what is defined in the lines following that.

The GX\_SetVtxDesc() calls tell the GP how we'll be providing the vertex data. We're specifying the format for vertex positions, normals and texture coordinates, respectively. GX\_DIRECT in this context means we'll be specifying them using calls like GX\_Position3f() (similar to glVertex3f()).

GX\_SetVtxAttrFmt() tells the GP how we're going to specify the information for vertices. Specifically it's the same as the previous three (vertex position, vertex normal and texture coordinates), except we can specify different formats for different vertex format slots. For example, if you were drawing a HUD, you could store its vertex format in a different slot, then call that slot up when drawing the HUD instead of having to reload the vertex attributes yourself every time. You give the slot you want to use in an operation in the call to GX\_Begin(), which is detailed below.

## Drawing Triangles\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=6)\]

The heart of drawing 3D shapes on the screen is more or less identical to OpenGL with a few changes. After drawing is set up (textures loaded, matrices applied, etc), the drawing commands can be dispatched. You lead off with this:

`GX_Begin(GX_TRIANGLES,GX_VTXFMT0,3);`

The first argument tells the GP what we want to draw. In this case, we're drawing triangles, i.e. every three vertices will be a single triangle on the screen. Other options for this are points, lines, line strip, triangle strip, triangle fan and quads. Which you use depends on what you're drawing and can have huge performance implications with high triangle counts.

The second argument is the vertex format to load. If you read through [Vertex Initialization](https://devkitpro.org/w/index.php?title=Vertex_Initialization&action=edit&redlink=1), you'd know that there are eight vertex format slots that you can use, and which one you want to use for that draw operation is specified here.

The last argument is the vertex count. This count *must* match the number of vertices that you are drawing. If this number is larger than the actual number of vertices that you specify, then GX will hang.

Once this call is made, you can call functions that give the specific information on each vertex. You need to have position for each, which you can call like this:

`GX_Position3f32(1.0f,0,0);`

If you followed [Vertex Initialization](https://devkitpro.org/w/index.php?title=Vertex_Initialization&action=edit&redlink=1), you saw that the vertex attribute example gave GX\_POS\_XYZ for the position vertex attribute, which means the vertices for this VA slot would be coordinates with three members, and here we're specifying the position coordinates for one of them. We would need to make two more of these calls so that we complete a triangle in addition to satisfy the vertex count we gave earlier. If you wanted to specify a normal for each vertex, you would make this call following the previous one:

`GX_Normal3f32(0,0,1.0f);`

This works much like glNormal, except you need one of these for *every* vertex, as opposed to just once as in OpenGL. The same goes to calls to GX\_TexCoord\*().


After you have made the appropriate draw calls, you close it with this:

`GX_End();`

This puts a token in the FIFO that tells the GP that you're finished giving commands for this drawing operation.

In your first GX programs, you might only have a very basic draw block that might only draw a single triangle with three vertices, and you might loop that block for every triangle you want to draw. In these cases, the above lines are sufficient. Obviously, the coordinate values would probably be read from a variable rather than declared statically if you're loading objects at run-time.

## Matrix Math\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=7)\]

Matrices are a big part of 3D graphics, as their versatility is well-suited to the types of operations performed when transforming, such as moving the camera around. libogc includes hand-written assembly routines for matrix math that utilize the Gekko CPU's paired-single instructions, making such operations blazing fast as well. If you need a primer on how matrix math works, take a look at the article here: [http://www.gamedev.net/reference/articles/article877.asp](http://www.gamedev.net/reference/articles/article877.asp)

If you are experienced with OpenGL, you'll probably be familiar with functions like glRotate and glTranslate. These types of functions are not present in libogc; you'll need to construct the appropriate chain of matrix functions to do the same thing. Fear not, however, as the matrix functions you'll use instead are very intuitive and aren't too much more difficult.

In your applications, or at least your early ones, matrices transform things such as your viewpoint in two ways: translation and rotation. Translation is the "panning" of something and "rotation" is the spin of it. For example, let's say we want to rotate the camera horizontally to represent the player looking left and right in a level. You might start with this code:

`guVector axis; Mtx m,v,mv;`

axis is a vector (an array with three elements) which will represent the axis that we want to rotate on, and m, v and mv are the matrices that represent the rotation, our view, and the combination of both. Specifically, m represents the *new* matrix that we're going to get the rotation from, and v is our *current view matrix* (i.e. it's the matrix that represents where our "camera" is pointing in the world). v is usually already declared and assigned earlier as our view matrix, but here I declared it for the purpose of demonstrating its presence. As per the linked article above, we need to start with a "neutral" matrix, which is the "identity". You'll use this to set it up:

`guMtxIdentity(m);`

This sets the given matrix to an identity matrix, and is basically equivalent to initializing it before using it. Next we need to apply the appropriate transformation; in this case, we're going to rotate, say, 90 degrees laterally:

`axis.x = 1.0f; axis.y = 0; axis.z = 0; guMtxRotAxisDeg(m, &axis, 90);`

The first argument, m, is our matrix-to-be-rotated. The second argument, axis, tells by what percentage we should rotate on which axes. The last argument, 90 in this case, is the number of degrees to rotate. You would rotate the same amount if axis.x was 0.5 and degrees was 180. In reality, this is actually a wrapper function that changes degrees to rads and then applies it, but this happens behind the scenes. Finally, we need to actually apply this rotation to our view matrix so that the changes are visible. We'll use this function to do that:

`guMtxConcat(m,v,mv);`

This function concatenates the matrices m and v together and gives the output in mv. Since mv is the result, we should use it when applying the transformation to our scene instead of v.

Translation would work the same, but there's a shortcut we can use. If we want to translate mv, we can do this:

`xtrans = 1.0f; ytrans = 0; ztrans = 0; guMtxTransApply(mv, mv, xtrans, ytrans, ztrans);`

xtrans, ytrans and ztrans are floats that represent the amount that we want to translate in each direction. The trick here is that the source and destination matrix are the same, so we reduce the complexity and number of operations. If mv is our view matrix, we'll need to actually apply it, which we'll do here:

`GX_LoadPosMtxImm(mv, GX_PNMTX0);`

This tells GX to load the matrix into the first position matrix slot, of which we have ten. For any position operations done from this point forward, this matrix will be applied to the vertices. Remember that this matrix needs to be updated any time the view changes; otherwise the view will stay the same.

## Textures\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=8)\]

Textures are normally provided in so-called TPL format. These are converted at compile-time to the appropriate format and linked into the final application in binary format. The build system has the necessary configuration already present to handle this. neheGX lessons with textures (such as lesson 5) have a makefile with the necessary lines present to handle conversion.

Accompanied with such TPL files are SCF files. These are XML files which have a list of textures. So far, I have only specified one texture per SCF file, like this:

`<filepath="Mud.bmp" id="mud" colfmt=4 />`

filepath is the path, relative to the texture directory, to the image file to be converted. id is the id to use to identify the texture in code when loading it into GX. I do not know what colfmt is for.


If you are going to use textures the whole time (i.e. you're not intending to unload any textures), then you can use this method of texture loading. First, you'll need to include the headers for each texture. In my example, Mud.bmp, I need to include these:

`#include "mud_tpl.h" #include "mud.h"`

Next, you'll need to declare the texture's in-memory representation struct:

`TPLFile mudTPL;`

When performing texture loading (usually some time after you've set up GX and the viewport), you'll use this structure to specify the texture in memory. After that, you'll need to "open" the TPL in memory:

`TPL_OpenTPLFromMemory(&mudTPL, (void *)mud_tpl,mud_tpl_size);`

You know that mudTPL has already been declared, but unless you were to peek at the headers included earlier, you won't know where the last two arguments came from. They were generated by gxtexconv and are the binary array and array size, respectively. Now it's time to actually put the texture into a struct to pass on to the GX subsystem. First you'll need to declare the variable somewhere:

`GXTexObj texture;`

Then you can load it in:

`TPL_GetTexture(&mudTPL,mud,&texture);`

mudTPL is the TPLFile struct from earlier, mud is the ID that we gave in the SCF file and texture is the new GXTexObj struct. From now on, you won't be dealing with the TPL struct.

It is possible to make a texture loader to load images in from the storage media, but WinterMute recommends against this because it can cause severe memory fragmentation during the conversion process. If you decide to do this, the steps are different from the ones above, but the end result will be the same: a GXTexObj with the texture in it.

Now you'll want to make sure that the texture projection (its appearance on the surface) is correct, which we'll do this way:

`Mtx mv,mr; f32 w = rmode->viWidth; f32 h = rmode->viHeight; GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX3x4, GX_TG_TEX0, GX_IDENTITY); guLightPerspective(mv, 45, (f32)w/h, 1.05f, 1.0f, 0.0f, 0.0f); guMtxTrans(mr, 0.0f, 0.0f, -1.0f); guMtxConcat(mv, mr, mv); GX_LoadTexMtxImm(mv, GX_TEXMTX0, GX_MTX3x4); GX_InvalidateTexAll();`

GX\_SetTexCoordGen() tells the graphics hardware how the texture coordinates should be generated; in other words, it tells the hardware how the textures should appear on the surface. In this example, we're telling it that texture 0 (remember that the hardware can handle eight textures per pass) uses a 3x4 identity matrix, which means that no special transformations should be performed while painting the textures. GX\_IDENTITY can alternatively be GX\_TEXMTX0 through GX\_TEXMTX9 if you want to apply a matrix to a texture.

The calls to guMtxTrans() and guMtxConcat() transform the texture matrix to match our viewpoint. They're subsequently loaded using GX\_LoadTexMtxImm() into the first texture matrix slot.

Finally, GX\_InvalidateTexAll() tells the graphics hardware to invalidate the textures in its texture cache, which will cause it to reload textures from system memory. You need to call this every time you make a change to a texture.

## Lighting\[[edit](https://devkitpro.org/w/index.php?title=libogc/GX&action=edit&section=9)\]

Much of the information in this section is taken from gl2gx's project wiki, and some of it is derived from code.

Lighting in GX is different from OpenGL. While OpenGL has diffuse, ambient and specular colors, as well as a global ambient color, GX only has diffuse light colors. Additionally, OpenGL has diffuse, ambient, specular and emission material colors, whereas GX has diffuse and ambient.
