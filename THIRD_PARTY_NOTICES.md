# Third-party notices

## ripgrep 15.2.0

DreamCoder redistributes ripgrep from https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0.
The following notices are copied from that release. The binary is distributed
under the MIT license or the Unlicense, at your option.

### COPYING

This project is dual-licensed under the Unlicense and MIT licenses.

You may use this code under the terms of either license.

### LICENSE-MIT

The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### UNLICENSE

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>

## shadcn/ui

The components in `desktop/src/components/shared/ui` were generated from
https://github.com/shadcn-ui/ui and adapted for DreamCoder. They are used under
the following license.

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## @pierre/trees 1.0.0

The desktop app's file tree uses `@pierre/trees`, Copyright 2025 Pierre Computer Company,
licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
Its NOTICE file reads:

This project includes some code derived from
[@headless-tree/core](https://github.com/lukasbach/headless-tree).

The initial version of this project used `headless-tree` as the underlying tree
implementation. We have since written our own core at `packages/path-store`, but
many of the best ideas from `headless-tree` made their way to `path-store` and
`trees`. It's hard to identify exactly which code this is at this point, but
definitely things like the drag and drop implementation and the general list
approach to rendering and I'm sure more. The work that `@lukasbach` has
contributed to this space is greatly appreciated. `<3`

Original license for `headless-tree/core`:

```
MIT License

Copyright (c) 2023 Lukas Bach

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## ShowAI 0.10.0

DreamCoder includes source code from ShowAI (https://github.com/Renaissance-Mind/ShowAI,
commit 9be7012364d7329e5de159e93b25fa1a9b2f6bae) in `vendor/showai`, with the changes listed in
`vendor/showai/README.md`. It is distributed under the MIT license. Its diagram components carry
templates from Archify (https://github.com/tt-a1i/archify), Diagram Design
(https://github.com/cathrynlavery/diagram-design) and Fireworks Tech Graph
(https://github.com/yizhiyanhua-ai/fireworks-tech-graph), all MIT licensed; their license texts and
notices are in `vendor/showai/src/components/blocks/diagrams/licenses.json`.

MIT License

Copyright (c) 2026 Renaissance Mind

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Open Design templates

DreamCoder bundles design templates converted from https://github.com/nexu-io/open-design
(commit 12d970eacc8971150e3c76470d2a9afe16dc2ed1). The repository is licensed under the
Apache License, Version 2.0, Copyright 2026 Open Design contributors; the full text is
bundled as `design-templates/LICENSE-open-design.txt`. The only change to the template
files is renaming `example.html` to `index.html`.

60 templates are bundled: 44 from the `design-templates/` folder and 16 from the `skills/` folder
of that repository. One template carries its own MIT license, Copyright (c) 2026 Aster Atelier
template contributors, bundled in its template folder as `LICENSE`:

- `aster-atelier`

## Open Design design systems

DreamCoder bundles 151 design systems (`DESIGN.md` and `tokens.css` each, with the name,
category and description from the package manifest) converted from
https://github.com/nexu-io/open-design (commit 12d970eacc8971150e3c76470d2a9afe16dc2ed1,
folder `design-systems/`). The repository is licensed under the Apache License,
Version 2.0, Copyright 2026 Open Design contributors; the full text is bundled as
`design-systems/LICENSE-open-design.txt`. The files are copied unchanged. The package
names are the names of real brands: the packages are style references written by Open
Design contributors, not official assets of those brands.

`cloudflare-kumo` is derived from https://github.com/cloudflare/kumo (commit
0c5832575c99988917b81cd752002e10f3dc9c7a) and is MIT licensed, Copyright (c) 2026
Cloudflare, Inc.; the license text is bundled as `design-systems/cloudflare-kumo/LICENSE`.

The package `tom-modern` was left out because its upstream states no license.

## Open Design web-clone scripts

DreamCoder bundles the scripts of the `web-clone` skill from https://github.com/nexu-io/open-design
(commit 12d970eacc8971150e3c76470d2a9afe16dc2ed1, folder `skills/web-clone/scripts`), MIT licensed,
Copyright (c) 2026 Jane (@xiaoerzhan / 小耳). The license text is bundled as `web-clone/LICENSE`.
The scripts are unchanged except `scripts/lib/system-browser.mjs` and
`scripts/lib/playwright-loader.mjs`, which now reach a browser only through the browser session
that the DreamCoder desktop app provides; the code that started a system browser or looked for one
was removed.
