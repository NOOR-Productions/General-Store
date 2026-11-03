# Bapi Store website

A static site: no build step, no server code. Upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel).

## Run it on your computer

The site loads its product list with `fetch`, so opening `index.html` by double-click will show the "shelves didn't load" page. Serve the folder instead:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Change prices and stock

Edit `data/products.json`. For each product:

- `price`: whole rupees.
- `inStock`: `true` or `false`. Out-of-stock items show "Out of stock" and a "Notify me" WhatsApp link.
- `featured`: shows in the Featured row.
- `popular`: shows in the Ordered often row.
- `comingSoon`: shows in the Coming soon row.
- `category`: a new name creates a new category chip automatically.
- `id`: must be unique and must never change. Carts and links use it, so you can add, remove and reorder products safely.

To add a product, copy a block, give it a new `id`, and add its photo to `Assets/products/`.

## Shop details

`data/store.json` holds the phone and WhatsApp number, address, opening hours, delivery fee, minimum order, pickup and payment options. Opening hours drive the Open / Closed label across the site.

## Please confirm before going live

- The phone and WhatsApp number (`+919832596691`). It came from the old WhatsApp link, because the old Contacts page only had a placeholder.
- `email` is empty. The old page showed noorproductions.as@gmail.com, which looks like the developer's address. Add the store's email if it has one.
- Delivery is free with no minimum, and payment options are "Cash on delivery" and "UPI on delivery". Change these in `store.json`.
- Product photos are about 225 px wide, so they look soft on large and high-density screens. Replace them with 600 px or larger photos, keeping the same file names.

## Error pages

- `404.html` is shown by the host for any address that doesn't exist. If the site is in a sub-folder (for example `https://name.github.io/bapi-store/`), change `BASE` near the bottom of `404.html` to `"/bapi-store/"`.
- `offline.html` appears if someone opens the site with no connection before it has been saved on their phone.
- Inside the app, unknown pages, unknown products and a failed product load each have their own friendly screen.

## After you change code

`sw.js` saves the site on visitors' phones so it works offline. When you change `css/style.css` or `js/app.js`, change `VERSION` in `sw.js` (for example to `bapi-v2`) so visitors get the update. Changes to `data/*.json` show up straight away.

## Before sharing the link

In `index.html`, change `og:image` to the full address of the hero photo (for example `https://yourdomain.com/Assets/hero.jpg`) so link previews show the shopfront.
