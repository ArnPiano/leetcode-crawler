// leet-crawler-auth.js
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const { convertFile } = require("./html-to-markdown");

const BASE_URL = "https://leetcode.com";
//const outputDir = path.join(__dirname, "output");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SAVE_HTML = false;
// --- Helper: Extract Blob data as Base64 ---
async function downloadBlob(page, blobUrl) {
  return await page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]); // Extract base64 part
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, blobUrl);
}

async function waitForImageLoaded(page, carouselIdx) {
  await page.evaluate(async (idx) => {
    const carousels = document.querySelectorAll(
      "div.relative.flex.flex-col.overflow-hidden",
    );
    const carousel = carousels[idx];
    const img = carousel?.querySelector("img");
    if (!img) return;

    // If already complete and has natural size, we're good
    if (img.complete && img.naturalWidth > 0) return;

    // Otherwise wait for the load event
    await new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", reject, { once: true });
      setTimeout(resolve, 3000); // safety timeout
    });

    // Also wait for the browser to finish decoding the image pixels
    await img.decode().catch(() => {});
  }, carouselIdx);
}

// Handle Blobs
async function captureCarouselSlides(page, outputDir) {
  const meta = [];

  const imagesDir = path.join(outputDir, "images");

  await fs.ensureDir(imagesDir);

  const carouselSelector = "div.relative.flex.flex-col.overflow-hidden";

  // Filter for real blob carousels
  const blobCarouselIndices = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel))
      .map((el, idx) =>
        el.querySelector("img")?.src.startsWith("blob:") ? idx : null,
      )
      .filter((idx) => idx !== null);
  }, carouselSelector);

  for (let i_ci = 0; i_ci < blobCarouselIndices.length; i_ci++) {
    const ci = blobCarouselIndices[i_ci];

    const getCarouselHandle = async () => (await page.$$(carouselSelector))[ci];

    let carouselHandle = await getCarouselHandle();

    // 1. Initial Wake Up: Click the container
    await carouselHandle.scrollIntoView();
    const box = await carouselHandle.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(800);

    const totalSlides = await page.evaluate(
      (sel, idx) => {
        const container = document.querySelectorAll(sel)[idx];
        const counter = Array.from(container.querySelectorAll("div")).find(
          (d) => d.textContent.includes("/"),
        );
        const match = counter?.textContent.match(/(\d+)\s*$/);
        return match ? parseInt(match[1], 10) : 1;
      },
      carouselSelector,
      ci,
    );

    meta.push({ ci, totalSlides });

    console.log(
      `Carousel ${i_ci}: Processing ${totalSlides} slides via Hardware Click...`,
    );

    for (let i = 0; i < totalSlides; i++) {
      // 2. Capture the current Blob URL
      const currentUrl = await page.evaluate(
        (sel, idx) => {
          return document.querySelectorAll(sel)[idx].querySelector("img")?.src;
        },
        carouselSelector,
        ci,
      );

      // ... inside captureCarouselSlides loop ...
      if (currentUrl && currentUrl.startsWith("blob:")) {
        const base64Data = await downloadBlob(page, currentUrl);
        await fs.writeFile(
          // CHANGE i_ci TO ci HERE
          path.join(imagesDir, `carousel_${ci}_slide_${i}.png`),
          base64Data,
          "base64",
        );
        console.log(`  [✓] Saved Slide ${i + 1}/${totalSlides}`);
      }

      // 3. Hardware Advance
      if (i < totalSlides - 1) {
        // Find the "Next" button coordinates
        const nextBtnSelector = `svg path[d*="7.913 19.071"]`; // Coordinates from your HTML
        const btnHandle = await carouselHandle.$(nextBtnSelector);

        if (btnHandle) {
          const btnBox = await btnHandle.boundingBox();
          if (btnBox) {
            // Move mouse to button and click like a human
            await page.mouse.move(
              btnBox.x + btnBox.width / 2,
              btnBox.y + btnBox.height / 2,
            );
            await page.mouse.down();
            await sleep(50);
            await page.mouse.up();
          }
        } else {
          // Fallback: Click the right-most area of the control bar
          await page.mouse.click(
            box.x + box.width - 40,
            box.y + box.height - 15,
          );
        }

        // 4. THE GATE: Wait for the counter text to change
        // This is more reliable than the URL for preventing duplicate saves
        try {
          await page.waitForFunction(
            (sel, idx, currentIdx) => {
              const container = document.querySelectorAll(sel)[idx];
              const divs = Array.from(container.querySelectorAll("div"));
              const counter = divs.find((d) => d.textContent.includes("/"));
              if (!counter) return false;

              const pageNum = parseInt(
                counter.textContent.split("/")[0].trim(),
              );
              return pageNum === currentIdx + 2; // Wait for "2" if we just finished "1"
            },
            { timeout: 8000 },
            carouselSelector,
            ci,
            i,
          );

          await sleep(500); // UI cooldown
        } catch (e) {
          console.warn(
            `  [!] Slide ${i + 2} failed to trigger. Try increasing sleep or checking button index.`,
          );
        }
      }
    }
  }
  return meta;
}

// Keep the downloadBlob helper from the previous response

// ----------------------------
// SAFE TITLE EXTRACTION
// ----------------------------
async function extractTitle(page) {
  // Try multiple strategies (LeetCode is inconsistent)

  const titleFromH1 = await page
    .$eval("h1", (el) => el.textContent.trim())
    .catch(() => null);

  if (titleFromH1) return titleFromH1;

  const titleFromMeta = await page
    .$eval("title", (el) => el.textContent.replace(" - LeetCode", "").trim())
    .catch(() => null);

  return titleFromMeta || "Unknown Problem";
}

// ----------------------------
// WAIT FOR PAGE STABILITY
// ----------------------------
async function waitForPageReady(page) {
  await page.waitForFunction(() => document.readyState === "complete");

  // extra hydration buffer (important for LeetCode)
  await sleep(2000);
}

// ----------------------------
// CRAWLER
// ----------------------------
async function crawl(slug, outputDir) {
  console.log("Launching browser...");

  /*const browser = await puppeteer.launch({
    headless: false,
    userDataDir: path.join(process.env.HOME, ".config/google-chrome"),
  });*/
  const browser = await puppeteer.launch({
    headless: false,
  });

  const page = await browser.newPage();

  const problemUrl = `${BASE_URL}/problems/${slug}/`;
  const editorialUrl = `${BASE_URL}/problems/${slug}/editorial/`;

  await fs.ensureDir(outputDir);

  // =========================
  // PROBLEM PAGE
  // =========================
  console.log("Opening problem page...");

  await page.goto(problemUrl, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);

  // --- ADD THIS SCROLL LOGIC ---
  await page.evaluate(async () => {
    // Scroll to the bottom to trigger hint loading
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1000));
    // Scroll back up to ensure carousels are visible for bounding boxes
    window.scrollTo(0, 0);
  });

  const carouselMeta = await captureCarouselSlides(page, outputDir);

  const title = await extractTitle(page);
  console.log("Title:", title);

  const problemHtml = await page.content();

  const problemHtmlPath = path.join(outputDir, `${slug}.html`);

  if (SAVE_HTML) {
    await fs.writeFile(problemHtmlPath, problemHtml);
  }

  const problemMd = await convertFile(
    problemHtml,
    { title, section: "Description", type: "problem", carouselMeta },
    browser,
    outputDir,
    page.url(),
  );

  console.log("Saved problem");

  // =========================
  // EDITORIAL PAGE
  // =========================

  console.log("Opening editorial page...");

  await page.goto(editorialUrl, {
    waitUntil: "domcontentloaded",
  });

  await waitForPageReady(page);

  // Same scroll logic as problem page — needed to trigger lazy-loaded carousel blobs
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1000));
    window.scrollTo(0, 0);
  });

  const editorialCarouselMeta = await captureCarouselSlides(page, outputDir);

  const hasAnyContent = await page.evaluate(() => {
    return document.body && document.body.innerText.length > 200;
  });

  if (!hasAnyContent) {
    console.log("Editorial not available or empty.");
    await browser.close();
    return;
  }

  await page.evaluate(() => {
    let i = 0;

    document.querySelectorAll("img").forEach((img) => {
      if (img.src.startsWith("blob:")) {
        img.src = `images/blob_${i++}.png`;
      }
    });
  });

  const editorialHtml = await page.content();

  const editorialHtmlPath = path.join(outputDir, `${slug}-editorial.html`);

  if (SAVE_HTML) {
    await fs.writeFile(editorialHtmlPath, editorialHtml);
  }

  const editorialMd = await convertFile(
    editorialHtml,
    {
      title,
      section: "Editorial",
      type: "editorial",
      carouselMeta: editorialCarouselMeta,
    },
    browser,
    outputDir,
    page.url(),
  );

  const finalMarkdown = problemMd.trim() + "\n\n---\n\n" + editorialMd.trim();

  const finalPath = path.join(outputDir, `${slug}.md`);
  await fs.writeFile(finalPath, finalMarkdown);

  console.log("Saved merged markdown:", finalPath);

  await browser.close();
}

function main() {
  const slug = process.argv[2];
  const outputArg = process.argv[3];

  if (!slug) {
    console.log("Usage: node leet-crawler-auth.js <slug> [output_folder]");
    process.exit(1);
  }

  const outputDir = outputArg ? path.resolve(outputArg) : path.resolve(slug);

  crawl(slug, outputDir).catch(console.error);
}

main();
