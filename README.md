# LeetCode Crawler

## Overview

This project is a **LeetCode crawler** that automatically downloads problem statements and editorials from LeetCode and converts them into clean, portable Markdown files. It is designed for building local knowledge bases, offline study materials, or documentation archives of solved problems.

The crawler uses a headless browser to load dynamic content, capture images (including carousel slides), and transform the rendered HTML into structured Markdown.

The main purpose of this project is to practice with JavaScript and web crawling of dynamic websites.

---

## Purpose

The main goals of this tool are:

* Archive LeetCode problems and editorials locally
* Convert dynamic web content into readable Markdown
* Preserve images, hints, and code snippets
* Enable offline study and version-controlled notes
* Automate repetitive manual copying from LeetCode

This tool is particularly useful for:

* Competitive programming practice
* Interview preparation
* Personal knowledge management
* Building searchable problem repositories

---

## Features

* Crawls **problem description** and **editorial** pages
* Converts HTML content to clean Markdown
* Downloads and embeds images locally
* Captures carousel slides (e.g., diagrams and step-by-step visuals)
* Preserves hints using collapsible `<details>` blocks
* Extracts multi-language code examples from playground widgets
* Merges problem and editorial into a single Markdown file
* Works with authenticated sessions if needed

---

## How It Works

1. Launches a browser using Puppeteer
2. Loads the LeetCode problem page
3. Waits for dynamic content to fully render
4. Captures images and interactive elements
5. Converts the page to Markdown
6. Repeats the process for the editorial page
7. Merges both outputs into a final Markdown file

---

## Requirements

* Node.js (v16 or newer recommended)
* npm or yarn
* A Chromium-compatible browser (automatically handled by Puppeteer)

### Dependencies

Typical dependencies include:

* `puppeteer`
* `turndown`
* `turndown-plugin-gfm`
* `jsdom`
* `axios`
* `fs-extra`

Install them with:

```bash
npm install
```

---

## Usage

Run the crawler from the command line:

```bash
node leet-crawler-auth.js <slug> [output_folder]
```

### Parameters

* `slug` — The LeetCode problem slug (required)
* `output_folder` — Optional directory for output files

### Example

```bash
node leet-crawler-auth.js two-sum
```

This will create:

```
two-sum/
├── two-sum.md
└── images/
```

Or specify a custom directory:

```bash
node leet-crawler-auth.js two-sum ./notes/arrays
```

---

## Output

The crawler generates:

* A single merged Markdown file
* A local `images/` directory
* Embedded references to downloaded media

Example structure:

```
problem-slug/
├── problem-slug.md
└── images/
    ├── problem_img_0.png
    ├── editorial_img_0.png
    └── carousel_0_slide_0.png
```

---

## Notes on Authentication

Some editorials require login or a premium subscription.

If authentication is required, run the browser in non-headless mode and log in manually. The session will persist for the duration of the run.

---

## Limitations

* Depends on the current structure of the LeetCode website
* May require updates if the site layout changes
* Premium editorials cannot be accessed without proper credentials
* Very large pages may take longer to process

---

## Development

Typical workflow:

```bash
npm install
node leet-crawler-auth.js <slug>
```

You can modify behavior such as:

* Headless vs non-headless browser mode
* HTML saving toggles
* Output formatting rules
* Image handling logic

---

## Acknowledgment

This project was **developed with the assistance of Large Language Models (LLMs)** to accelerate implementation, debugging, and design of the crawling and HTML-to-Markdown conversion logic.

Human engineering decisions, testing, and integration remain essential parts of the development process.

---

## License

Use responsibly and in accordance with LeetCode's Terms of Service.
