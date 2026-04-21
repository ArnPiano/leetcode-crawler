// html-to-markdown.js
const TurndownService = require("turndown");
const { JSDOM } = require("jsdom");
const { gfm } = require("turndown-plugin-gfm");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

function processHints(doc) {
  const hintsFound = [];

  // 1. Find all Hint titles
  const hintTitles = Array.from(doc.querySelectorAll(".text-body")).filter(
    (el) => /^Hint \d+$/.test(el.textContent.trim()),
  );

  hintTitles.forEach((titleEl) => {
    const titleText = titleEl.textContent.trim();
    const headerGroup = titleEl.closest(".group");
    if (!headerGroup) return;

    const contentWrapper = headerGroup.nextElementSibling;
    if (!contentWrapper) return;

    const hintContent =
      contentWrapper.querySelector(".HTMLContent_html__0OZLp") ||
      contentWrapper;

    // Create the <details> structure
    const details = doc.createElement("details");
    const summary = doc.createElement("summary");
    summary.textContent = titleText;
    details.appendChild(summary);

    const contentClone = hintContent.cloneNode(true);
    details.appendChild(contentClone);

    // Replace the LeetCode hint block with our clean HTML
    const hintBlock = headerGroup.closest(".flex-col");
    if (hintBlock) {
      hintBlock.replaceWith(details);
      hintsFound.push(details);
    }
  });

  return hintsFound;
}

function createTurndown() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.use(gfm);

  // --------------------
  // CODE BLOCKS
  // --------------------

  turndown.addRule("noHeadingEscape", {
    filter: (node) =>
      node.nodeName === "H1" ||
      node.nodeName === "H2" ||
      node.nodeName === "H3" ||
      node.nodeName === "H4",

    replacement: (content, node) => {
      const level = Number(node.nodeName.replace("H", ""));
      return `\n${"#".repeat(level)} ${content}\n\n`;
    },
  });

  turndown.addRule("details-summary", {
    filter: ["details", "summary"],
    replacement: (content, node) => {
      if (node.nodeName === "SUMMARY") {
        // Double newline after summary helps some markdown parsers
        return `<summary>${content.trim()}</summary>\n\n`;
      }
      // Trim content and wrap in details
      return `<details>\n${content.trim()}\n\n</details>\n\n`;
    },
  });

  // --------------------
  // INLINE CODE
  // --------------------
  turndown.addRule("inlineCode", {
    filter: (node) =>
      node.nodeName === "CODE" && node.parentNode.nodeName !== "PRE",

    replacement: (_, node) => `\`${node.textContent}\``,
  });

  // --------------------
  // BLOCKQUOTE
  // --------------------
  turndown.addRule("blockquote", {
    filter: "blockquote",
    replacement: (content) =>
      content
        .split("\n")
        .map((line) => (line ? "> " + line : line))
        .join("\n") + "\n\n",
  });

  // --------------------
  // KA TEX FIXED
  // --------------------
  turndown.addRule("katex", {
    filter: (node) =>
      node.classList &&
      (node.classList.contains("katex") ||
        node.classList.contains("katex-mathml") ||
        node.classList.contains("katex-html")),

    replacement: (_, node) => node.textContent.trim(),
  });

  // --------------------
  // TABLE FIXED
  // --------------------
  turndown.addRule("leetcodeCodeBlock", {
    filter: (node) => node.nodeName === "PRE",

    replacement: (_, node) => {
      const codeNode = node.querySelector("code");

      const text = (codeNode?.textContent || node.textContent || "").trim();

      if (!text) return "";

      const lang =
        codeNode?.getAttribute("data-language") ||
        (codeNode?.className || "").match(/language-(\w+)/)?.[1] ||
        "";

      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    },
  });

  // --------------------
  // REMOVE NOISE
  // --------------------

  turndown.addRule("preserveDivText", {
    filter: "div",
    replacement: (content, node) => {
      const text = node.textContent?.trim();
      if (!text) return "";
      return `\n${content}\n`;
    },
  });

  turndown.remove([
    "script",
    "style",
    "svg",
    "button",
    "nav",
    "header",
    "footer",
  ]);

  return turndown;
}

function cleanDOM(document) {
  const selectors = [
    "header",
    "footer",
    "nav",
    "script",
    "style",
    "svg",
    '[role="button"]',
    "div#discussion-container",
    "div.discussion-node",

    // Tab bar: "Description | Editorial | Solutions | Submissions..."
    '[role="tablist"]',
    '[role="tab"]',

    // Comment / discussion sections (various LeetCode layouts)
    '[class*="comment"]',
    '[class*="discussion"]',
    '[id*="comment"]',
    '[id*="discussion"]',
  ];

  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  });

  const noisePhrases = [];
  const allDivs = document.querySelectorAll("div, p, span");
  allDivs.forEach((el) => {
    if (noisePhrases.some((phrase) => el.textContent.includes(phrase))) {
      el.remove();
    }
  });

  return document;
}

function resolveImageUrl(src, baseUrl) {
  if (!src) return null;

  // Already absolute
  if (src.startsWith("http")) {
    return src;
  }

  // Handle ../Figures/... paths correctly
  if (src.includes("../Figures/")) {
    const relative = src.replace("../Figures/", "");

    return (
      "https://assets.leetcode.com/static_assets/media/original_images/" +
      relative
    );
  }

  // Generic fallback
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

//content = document.querySelector('[data-track-load="description_content"]') || document.querySelector("#solution")?.parentElement;
async function downloadImages(content, outputDir, meta, baseUrl) {
  const images = content.querySelectorAll("img");

  const imagesDir = path.join(outputDir, "images");

  await fs.ensureDir(imagesDir);

  let index = 0;

  for (const img of images) {
    let src =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src");

    if (!src) {
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        src = srcset.split(",")[0].trim().split(" ")[0];
      }
    }

    // handle relative URLs
    if (src.startsWith("/")) {
      src = "https://leetcode.com" + src;
    }

    try {
      const ext = path.extname(src).split("?")[0] || ".png";

      const filename = `${meta.type}_img_${index}${ext}`;

      const filepath = path.join(imagesDir, filename);

      const resolvedUrl = resolveImageUrl(src, baseUrl);
      if (!resolvedUrl) continue;

      const response = await axios.get(resolvedUrl, {
        responseType: "arraybuffer",
      });

      await fs.writeFile(filepath, response.data);

      img.setAttribute("src", `images/${filename}`);

      index++;
    } catch (err) {
      console.log("Failed image:", src, err.message);
    }
  }
}

function injectCarouselMarkdown(root, carouselMeta) {
  const counters = Array.from(root.querySelectorAll("div")).filter((div) =>
    /^\d+\s*\/\s*\d+$/.test(div.textContent.trim()),
  );

  counters.forEach((counter, metaIndex) => {
    const carouselData = carouselMeta[metaIndex];
    if (!carouselData) return;

    const carouselContainer =
      counter.closest("div.relative.flex.flex-col.overflow-hidden") ||
      counter.parentElement?.parentElement;
    if (!carouselContainer) return;

    let md = "\n";
    for (let i = 0; i < carouselData.totalSlides; i++) {
      md += `![slide ${i + 1}](images/carousel_${carouselData.ci}_slide_${i}.png)\n\n`;
    }

    const doc = root.ownerDocument || root;
    const wrapper = doc.createElement("div");
    wrapper.innerHTML = md;
    carouselContainer.replaceWith(wrapper);
  });
}

async function inlinePlaygroundCode(document, browser) {
  const iframes = document.querySelectorAll("iframe");

  for (const iframe of iframes) {
    const src = iframe.getAttribute("src");
    if (!src || !src.includes("/playground/")) continue;

    try {
      const page = await browser.newPage();

      await page.goto(src, { waitUntil: "domcontentloaded" });

      await page.waitForSelector(".lang-btn-set .btn");
      await page.waitForSelector("textarea[name='lc-codemirror']");

      const result = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll(".lang-btn-set .btn"),
        );

        const languages = buttons.map((b) => b.textContent.trim());

        const codes = [];

        // helper: click + extract textarea value
        const textarea = document.querySelector(
          "textarea[name='lc-codemirror']",
        );

        function sleep(ms) {
          return new Promise((r) => setTimeout(r, ms));
        }

        return (async () => {
          for (let i = 0; i < buttons.length; i++) {
            buttons[i].click();
            await sleep(100);

            codes.push({
              language: languages[i],
              code: textarea.value,
            });
          }

          return codes;
        })();
      });

      // ⚠️ puppeteer cannot return async-in-evaluate properly
      // so we do it correctly outside:

      const codes = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const buttons = Array.from(
          document.querySelectorAll(".lang-btn-set .btn"),
        );

        const textarea = document.querySelector(
          "textarea[name='lc-codemirror']",
        );

        const results = [];

        for (const btn of buttons) {
          btn.click();
          await sleep(150);

          results.push({
            language: btn.textContent.trim(),
            code: textarea.value,
          });
        }

        return results;
      });

      await page.close();

      const blocks = codes.map((c) => {
        const langMap = {
          "C++": "cpp",
          Java: "java",
          C: "c",
          "C#": "csharp",
          JavaScript: "javascript",
          Go: "go",
          Python3: "python",
          TypeScript: "typescript",
        };

        const mdLang = langMap[c.language] || "";

        const cleanCode = c.code
          .replace(/\u00a0/g, " ")
          .replace(/\t/g, "    ")
          .replace(/\r/g, "")
          .trim();

        return [
          `#### ${c.language}`,
          "",
          "```" + mdLang,
          cleanCode,
          "```",
          "",
        ].join("\n");
      });
      const finalMarkdown = blocks.join("\n");

      const container = document.createElement("div");

      // We insert structured HTML, not markdown text
      for (const c of codes) {
        const langMap = {
          "C++": "cpp",
          Java: "java",
          C: "c",
          "C#": "csharp",
          JavaScript: "javascript",
          Go: "go",
          Python3: "python",
          TypeScript: "typescript",
        };

        const mdLang = langMap[c.language] || "";

        const section = document.createElement("div");

        const h4 = document.createElement("h4");
        h4.textContent = c.language;

        const pre = document.createElement("pre");
        const code = document.createElement("code");

        if (mdLang) code.className = `language-${mdLang}`;

        code.textContent = c.code
          .replace(/\u00a0/g, " ")
          .replace(/\t/g, "    ")
          .replace(/\r/g, "")
          .trim();

        pre.appendChild(code);

        section.appendChild(h4);
        section.appendChild(pre);

        container.appendChild(section);
      }

      iframe.replaceWith(container);
    } catch (err) {
      console.log("Failed playground:", src, err.message);
    }
  }
}

function normalizeMarkdown(md) {
  return (
    md
      .replace(/\n{3,}/g, "\n\n")
      .replace(/```\n\n/g, "```\n")
      .replace(/\[\s*\]\s*\(/g, "[](")
      .trim()
      // This one stays — it removes the premium video section which is before #solution
      // and can still appear if the page structure varies
      .replace(/##\W\[\]\(#video-solution[^#]+/g, "")
      .replace(/(## \[\]\(#solution\)Solution)\s+\* \* \*/g, "$1") + "\n"
  );
}

function fixEscapedCarousels(md) {
  return md.replace(
    /(!\\\[[^\]]+\\\]\([^)]+\)(?:\s*!\\\[[^\]]+\\\]\([^)]+\))*)/g,
    (match) => {
      return match
        .replace(/!\\\[/g, "![")
        .replace(/\\\]/g, "]")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\_/g, "_");
    },
  );
}

function fixCommentSection(md) {
  return md.replace(/^Comments\s*\([^)]*\)\s*[\s\S]*/im, "");
}

function removeStatsBlock(md) {
  return md.replace(/(Accepted[\s\S]*?Acceptance Rate[\s\S]*?\n)(?=##|$)/g, "");
}

async function convertFile(htmlString, meta = {}, browser, outputDir, pageUrl) {
  const dom = new JSDOM(htmlString, { url: pageUrl });
  const document = cleanDOM(dom.window.document);

  // 1. Process hints globally within the document
  const extractedHints = processHints(document);

  // 2. Select main content
  let content = document.querySelector(
    '[data-track-load="description_content"]',
  );

  if (meta.type === "editorial") {
    // #solution anchor is not present in the serialized HTML.
    // The editorial content lives in the solution-markdown wrapper div.
    // This selector is stable: it's the only element on the page with this class,
    // and it excludes the left description panel, the tab bar, and all comments.
    content = document.querySelector('[class*="solution-markdown"]');
    if (!content) return ""; // No free editorial (premium-only page) — bail out cleanly
  }

  if (!content) content = document.body;

  // 3. IMPORTANT: If hints were found but are NOT inside 'content', append them
  // This ensures they show up in the final Markdown
  extractedHints.forEach((hint) => {
    if (!content.contains(hint)) {
      content.appendChild(hint);
    }
  });

  /* OLD
  // 3. Handle specific media/interactive elements
  
  await downloadImages(content, outputDir, meta, pageUrl);
  await inlinePlaygroundCode(document, browser);

  // 4. Transform carousels (using your second, better version of this function)
  injectCarouselMarkdown(document, meta.carouselMeta || []);
  */

  // New content download logic

  // 3. Transform carousels (using your second, better version of this function)
  injectCarouselMarkdown(content, meta.carouselMeta || []); // pass content, not document

  // 4. Handle specific media/interactive elements
  await downloadImages(content, outputDir, meta, pageUrl);
  await inlinePlaygroundCode(document, browser);

  // 5. Convert to Markdown
  const turndown = createTurndown();
  let markdown = turndown.turndown(content);

  // 6. Post-process
  markdown = normalizeMarkdown(markdown);
  markdown = fixEscapedCarousels(markdown);
  markdown = fixCommentSection(markdown);
  markdown = removeStatsBlock(markdown);

  if (meta.title && meta.type !== "editorial") {
    markdown =
      `# ${meta.title}\n\n## ${meta.section || "Description"}\n\n` + markdown;
  }

  return markdown;
}

module.exports = { convertFile };
