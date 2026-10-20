// Toonily — https://toonily.com (Madara)
const BASE = "https://toonily.com";
const MANGA_PATH = "serie";
const PAGE_SIZE = 25;

function headers(extra) {
  const out = {
    Referer: BASE + "/",
    Cookie: "toonily-mature=1",
  };
  if (extra) {
    for (const key in extra) out[key] = extra[key];
  }
  return out;
}

function get(url) {
  return mm.http.get(url, headers());
}

function post(url, body) {
  return mm.http.post(
    url,
    body,
    headers({
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    })
  );
}

function abs(url) {
  return mm.util.absoluteURL(BASE, url || "");
}

function formBody(fields) {
  const parts = [];
  for (const key in fields) {
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(fields[key]));
  }
  return parts.join("&");
}

function statusOf(text) {
  const t = String(text || "").toLowerCase();
  if (/completed|complete|finalizado/.test(t)) return "completed";
  if (/ongoing|on going|updating/.test(t)) return "ongoing";
  if (/hiatus|on hold/.test(t)) return "hiatus";
  return "unknown";
}

function imageFromAttrs(attrs) {
  return (
    attrs["data-src"] ||
    attrs["data-lazy-src"] ||
    attrs["data-lzl-src"] ||
    attrs["data-cfsrc"] ||
    attrs["data-manga-src"] ||
    (attrs.srcset ? attrs.srcset.split(",")[0].trim().split(/\s+/)[0] : "") ||
    attrs.src ||
    ""
  );
}

function cleanCover(url) {
  if (!url) return "";
  return abs(url).replace(/-\d+x\d+(\.\w+)($|\?)/, "$1$2");
}

function pathOnly(url) {
  return String(url || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/\/+$/, "")
    .split("?")[0]
    .split("#")[0];
}

function isMangaUrl(url) {
  // Manga pages are /serie/slug — not /serie/slug/chapter-1
  return /^\/?(serie|webtoon|manga)\/[^/]+$/i.test(pathOnly(url));
}

function mangaIdFromPath(path) {
  return pathOnly(path)
    .replace(/^\/?(webtoon|serie|manga)\//i, "")
    .split("/")[0];
}

function mangaPath(id) {
  return "/" + MANGA_PATH + "/" + id + "/";
}

function cleanTitle(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(HOT|NEW|TRENDING|COMPLETED|ONGOING)\s*$/i, "")
    .trim();
}

function parseArchive(html) {
  if (/just a moment|cf-browser-verification|challenge-platform/i.test(html || "")) {
    mm.errors.fail("Cloudflare challenge. Open Toonily once from the challenge sheet, then retry.");
  }
  const items = [];
  const seen = {};
  // Prefer manga cards; plain page-item-detail also catches non-title widgets.
  let list = mm.html.select(html, "div.page-item-detail.manga");
  if (!list.length) list = mm.html.select(html, "div.page-item-detail");
  if (!list.length) list = mm.html.select(html, "div.c-tabs-item__content");
  for (let i = 0; i < list.length; i++) {
    const card = list[i].html;
    // Madara puts the real series title on .post-title a — not chapter rows.
    let link =
      mm.html.select(card, ".post-title a")[0] ||
      mm.html.select(card, "div.post-title a")[0] ||
      mm.html.select(card, "h3 a")[0] ||
      mm.html.select(card, "h5 a")[0];
    if (!link || !isMangaUrl(link.attrs.href || "")) {
      const anchors = mm.html.select(card, "a");
      link = null;
      for (let j = 0; j < anchors.length; j++) {
        if (isMangaUrl(anchors[j].attrs.href || "")) {
          const text = cleanTitle(anchors[j].text);
          // Skip empty cover wrappers; keep the titled series link.
          if (!text) {
            if (!link) link = anchors[j];
            continue;
          }
          link = anchors[j];
          break;
        }
      }
    }
    if (!link) continue;
    const href = link.attrs.href || "";
    if (!isMangaUrl(href)) continue;
    const id = mangaIdFromPath(href);
    if (!id || seen[id]) continue;
    seen[id] = true;
    const title = cleanTitle(link.text) || id;
    const img = mm.html.select(card, "img")[0];
    const cover = img ? cleanCover(imageFromAttrs(img.attrs)) : "";
    items.push({ id: id, title: title, cover: cover || undefined });
  }
  return items;
}

function loadMore(page, mode, query, filters) {
  const fields = {
    action: "madara_load_more",
    page: String(page - 1),
    template: "madara-core/content/content-archive",
    "vars[paged]": "1",
    "vars[template]": "archive",
    "vars[posts_per_page]": String(PAGE_SIZE),
    "vars[post_type]": "wp-manga",
    "vars[post_status]": "publish",
    "vars[manga_archives_item_layout]": "big_thumbnail",
  };
  if (mode === "popular") {
    fields["vars[orderby]"] = "meta_value_num";
    fields["vars[meta_key]"] = "_wp_manga_views";
    fields["vars[order]"] = "DESC";
  } else if (mode === "latest") {
    fields["vars[orderby]"] = "meta_value_num";
    fields["vars[meta_key]"] = "_latest_update";
    fields["vars[order]"] = "DESC";
  } else {
    if (query) fields["vars[s]"] = query;
    const order = (filters && filters.order) || "views";
    if (order === "latest") {
      fields["vars[orderby]"] = "meta_value_num";
      fields["vars[meta_key]"] = "_latest_update";
      fields["vars[order]"] = "DESC";
    } else if (order === "alphabet") {
      fields["vars[orderby]"] = "post_title";
      fields["vars[order]"] = "ASC";
    } else if (order === "new-manga") {
      fields["vars[orderby]"] = "date";
      fields["vars[order]"] = "DESC";
    } else {
      fields["vars[orderby]"] = "meta_value_num";
      fields["vars[meta_key]"] = "_wp_manga_views";
      fields["vars[order]"] = "DESC";
    }
    if (filters && filters.genre) {
      fields["vars[tax_query][0][taxonomy]"] = "wp-manga-genre";
      fields["vars[tax_query][0][field]"] = "slug";
      fields["vars[tax_query][0][terms][0]"] = filters.genre;
    }
  }
  const res = post(BASE + "/wp-admin/admin-ajax.php", formBody(fields));
  let items = parseArchive(res.body);
  // First-page HTML fallback when ajax is challenged or returns junk widgets.
  if (!items.length && page === 1 && mode !== "search") {
    const order = mode === "latest" ? "latest" : "views";
    const pageRes = get(BASE + "/" + MANGA_PATH + "/?m_orderby=" + order);
    items = parseArchive(pageRes.body);
  }
  return { items: items, hasNext: items.length >= PAGE_SIZE };
}

function parseChapterDate(text) {
  if (!text) return undefined;
  const value = text.trim();
  const lower = value.toLowerCase();
  const now = new Date();
  if (/^today/.test(lower)) return now.toISOString().slice(0, 10) + "T00:00:00Z";
  if (/^yesterday/.test(lower)) {
    now.setUTCDate(now.getUTCDate() - 1);
    return now.toISOString().slice(0, 10) + "T00:00:00Z";
  }
  const relative = lower.match(/(\d+)\s*(year|month|week|day|hour|minute|second)/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit.indexOf("year") === 0) now.setUTCFullYear(now.getUTCFullYear() - amount);
    else if (unit.indexOf("month") === 0) now.setUTCMonth(now.getUTCMonth() - amount);
    else if (unit.indexOf("week") === 0) now.setUTCDate(now.getUTCDate() - amount * 7);
    else if (unit.indexOf("day") === 0) now.setUTCDate(now.getUTCDate() - amount);
    else if (unit.indexOf("hour") === 0) now.setUTCHours(now.getUTCHours() - amount);
    else if (unit.indexOf("minute") === 0) now.setUTCMinutes(now.getUTCMinutes() - amount);
    else now.setUTCSeconds(now.getUTCSeconds() - amount);
    return now.toISOString();
  }
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) return new Date(parsed).toISOString();
  return undefined;
}

globalThis.source = {
  manifest: {
    id: "en.toonily",
    name: "Toonily",
    version: 6,
    language: "en",
    nsfw: true,
    baseURL: BASE,
    domains: ["toonily.com", "tnlycdn.com", "wp.com", "googleusercontent.com"],
    rateLimitPerSecond: 3,
    imageHeaders: {
      Referer: BASE + "/",
    },
    listings: [
      { id: "popular", name: "Popular" },
      { id: "latest", name: "Latest" },
    ],
    defaultReadingMode: "webtoon",
    capabilities: ["listings", "search"],
    settings: [],
  },

  getListing(listingId, page) {
    return loadMore(page, listingId === "latest" ? "latest" : "popular");
  },

  search(query, page, filters) {
    const cleaned = String(query || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return loadMore(page, "search", cleaned, filters || {});
  },

  getFilters() {
    return [
      {
        id: "order",
        name: "Order",
        kind: "select",
        defaultValue: "views",
        options: ["views", "latest", "alphabet", "new-manga"],
      },
      {
        id: "genre",
        name: "Genre",
        kind: "select",
        defaultValue: "",
        options: [
          "", "action", "adventure", "comedy", "drama", "fantasy", "horror", "mature",
          "mystery", "romance", "school-life", "sci-fi", "slice-of-life", "supernatural",
          "tragedy", "webtoons",
        ],
      },
    ];
  },

  getManga(id) {
    const res = get(BASE + mangaPath(id));
    const html = res.body;
    if (/just a moment|cf-browser-verification|challenge-platform/i.test(html || "")) {
      mm.errors.fail("Cloudflare challenge. Open Toonily once from the challenge sheet, then retry.");
    }
    const titleNode =
      mm.html.select(html, "div.post-title h1")[0] ||
      mm.html.select(html, "div.post-title h3")[0] ||
      mm.html.select(html, "#manga-title h1")[0] ||
      mm.html.select(html, "h1")[0];
    // Strip Madara badge spans so titles are not "SeriesHOT".
    let title = id;
    if (titleNode) {
      const bare = String(titleNode.html || "")
        .replace(/<span[^>]*manga-title-badges[^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/<[^>]+>/g, " ");
      title = cleanTitle(bare) || cleanTitle(titleNode.text) || id;
    }
    const img =
      mm.html.select(html, "div.summary_image img")[0] ||
      mm.html.select(html, "div.summary_image")[0];
    let cover = "";
    if (img) {
      if (img.tag === "img") cover = cleanCover(imageFromAttrs(img.attrs));
      else {
        const nested = mm.html.select(img.html, "img")[0];
        if (nested) cover = cleanCover(imageFromAttrs(nested.attrs));
      }
    }
    const authorLinks = mm.html.select(html, "div.author-content a");
    const authors = authorLinks.map(function (n) { return n.text.trim(); }).filter(Boolean);
    const genreLinks = mm.html.select(html, "div.genres-content a");
    const tags = genreLinks.map(function (n) { return n.text.trim(); }).filter(Boolean);
    const descNode =
      mm.html.select(html, "div.content-area div.summary__content")[0] ||
      mm.html.select(html, "div.summary__content")[0] ||
      mm.html.select(html, "div.description-summary div.summary__content")[0];
    let description = descNode ? descNode.text.replace(/\s+/g, " ").trim() : undefined;
    const statusNodes = mm.html.select(html, "div.summary-content");
    let status = "unknown";
    for (let i = 0; i < statusNodes.length; i++) {
      const text = statusNodes[i].text.toLowerCase();
      if (/ongoing|completed|hiatus|canceled|cancelled/.test(text)) {
        status = statusOf(text);
        break;
      }
    }
    return {
      id: id,
      title: title,
      author: authors.length ? authors.join(", ") : undefined,
      description: description,
      cover: cover || undefined,
      status: status,
      tags: tags,
      nsfw: true,
    };
  },

  getChapters(mangaId) {
    const path = mangaPath(mangaId);
    const res = post(BASE + path.replace(/\/?$/, "/") + "ajax/chapters/", "");
    let html = res.body;
    if (!html || html.length < 40) {
      const page = get(BASE + path);
      html = page.body;
    }
    const rows = mm.html.select(html, "li.wp-manga-chapter");
    const chapters = [];
    for (let i = 0; i < rows.length; i++) {
      const link = mm.html.select(rows[i].html, "a")[0];
      if (!link) continue;
      const href = link.attrs.href || "";
      const slug = href.replace(/\/+$/, "").split("/").pop();
      if (!slug) continue;
      const dateNode = mm.html.select(rows[i].html, "span.chapter-release-date")[0];
      const title = link.text.replace(/\s+/g, " ").trim();
      const numMatch = title.match(/([0-9]+(?:\.[0-9]+)?)/);
      chapters.push({
        id: slug,
        title: title,
        chapter: numMatch ? Number(numMatch[1]) : undefined,
        date: parseChapterDate(dateNode && dateNode.text),
        language: "en",
      });
    }
    if (!chapters.length) mm.errors.fail("No chapters found.");
    return chapters;
  },

  getPages(mangaId, chapterId) {
    let url = BASE + mangaPath(mangaId) + chapterId + "/";
    let res = get(url);
    if (/id=["']single-pager["']/.test(res.body)) {
      res = get(url + (url.indexOf("?") === -1 ? "?" : "&") + "style=list");
    }
    const nodes = mm.html.select(res.body, "div.page-break");
    const extras = nodes.length ? nodes : mm.html.select(res.body, "li.blocks-gallery-item");
    const pages = [];
    if (extras.length) {
      for (let i = 0; i < extras.length; i++) {
        const img = mm.html.select(extras[i].html, "img")[0];
        if (!img) continue;
        const src = imageFromAttrs(img.attrs);
        if (!src) continue;
        pages.push({ url: abs(src), headers: { Referer: url } });
      }
    } else {
      const imgs = mm.html.select(res.body, "div.reading-content img");
      for (let i = 0; i < imgs.length; i++) {
        const src = imageFromAttrs(imgs[i].attrs);
        if (!src) continue;
        pages.push({ url: abs(src), headers: { Referer: url } });
      }
    }
    if (!pages.length) mm.errors.fail("No pages found.");
    return pages;
  },
};
