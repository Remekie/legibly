=== BlindGEO — AI Visibility ===
Contributors: blindgeo
Tags: seo, ai, aeo, llms.txt, generative engine optimization, chatgpt, perplexity, ai search
Requires at least: 5.9
Tested up to: 6.7
Stable tag: 1.0.0
Requires PHP: 7.4
License: GPLv2 or later

Connect your WordPress site to BlindGEO. Apply AI visibility fixes — robots.txt, llms.txt, schema — in one click.

== Description ==

BlindGEO scans any website and grades its AI visibility A–F. This plugin connects your WordPress site to your BlindGEO account so you can apply all fixes in one click — no FTP, no code editing required.

**What it fixes:**

* **Search rules** — Adds AI crawler rules (GPTBot, ClaudeBot, PerplexityBot) to your robots.txt so AI search engines can access your site
* **AI summary** — Creates and maintains your /llms.txt file — a plain-text guide that tells AI models what your business does
* **Business identity** — Injects Organization schema (JSON-LD) into your page head so AI knows your business name, what you offer, and where you're located

**How it works:**

1. Install and activate this plugin
2. Go to Settings → BlindGEO and copy your API token
3. Scan your site at [blindgeo.com](https://blindgeo.com) (free)
4. In the Deploy tab, connect WordPress and paste your token
5. Click "Apply all fixes" — done

The plugin also adds an AI visibility status widget to your WordPress dashboard, showing which fixes are applied.

**Free forever.** This plugin is the fix delivery mechanism for BlindGEO. The plugin itself is free. BlindGEO's scanning, monitoring, and competitor tracking features are available at blindgeo.com.

== Installation ==

1. Upload the plugin to `/wp-content/plugins/blindgeo`
2. Activate through the 'Plugins' menu in WordPress
3. Go to Settings → BlindGEO to get your API token

== Frequently Asked Questions ==

= Does this plugin slow down my site? =

No. The plugin adds one small filter to robots.txt and one wp_head action to inject schema. Both are minimal.

= Will it conflict with Yoast SEO or Rank Math? =

No. The plugin is designed to coexist with existing SEO plugins. Schema injection uses a separate action hook with priority 1, and robots.txt additions are prepended, not replacing existing rules.

= Do I need a BlindGEO account? =

To use the one-click fix feature, yes. You need a BlindGEO account at blindgeo.com (free scan available). The plugin itself works without an account to display your fix status.

= What happens if BlindGEO can't reach my site? =

Fixes are stored in WordPress options and applied locally. The plugin does not require an active connection to BlindGEO to serve robots.txt rules or inject schema.

== Changelog ==

= 1.0.0 =
* Initial release
* robots.txt AI crawler rules
* llms.txt generation and file write
* Organization schema JSON-LD injection
* WordPress dashboard widget
* REST API for BlindGEO integration
