# STEMORA brand assets

The logo was supplied and approved by the owner on 30 October 2026.
`stemora-original.jpg` preserves the supplied artwork locally.

The website uses `frontend/public/brand/stemora-logo.svg` and
`stemora-symbol.svg`. These SVG presentation wrappers embed a resized copy
of the original JPEG, frame the artwork, and apply a luminance mask at render
time to remove the dark backdrop. Lettering and symbol geometry come from
the supplied artwork. These are not hand-traced vector paths.
The symbol also supplies `frontend/src/app/icon.svg`.

Two built-in imagegen background-extraction attempts were evaluated and not
used because they introduced damaged edges. Prompt: “Preserve exact original
supplied lime triple-band curved S icon and cream stemora typography; remove
only the dark background; transparent background, flat opaque fills, smooth
clean edges, no redesign.” The production assets retain the original image.

Check the logo on desktop login, private sidebar, mobile header, and browser
favicon after a frontend-only deployment. No backend, queue or database
settings are changed for this branding update.
