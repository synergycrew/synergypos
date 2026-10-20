# Wayline

A browser-based bus booking and station food-ordering demo. Passengers can browse bus departures, book tickets, order food for a selected trip, and review their tickets. The operations panel manages bus lines, menu items, and food-order status.

## Run

Open `index.html` in a browser. Alternatively, start a local server from this folder:

```powershell
npx serve .
```

The app loads Lucide icons, fonts, and food/travel photography from external services. If those services are unavailable, core controls and workflows remain usable.

## Supabase cloud sync

To configure Supabase once for every device, open `supabase-config.js` and enter the project URL and anon/public key in `url` and `anonKey`. Publish that file with the POS. The app then connects automatically on every device; there is no need to enter the credentials separately in Settings. If those shared values are blank, Settings can still be used for a device-only configuration.

Once connected, POS changes are automatically saved to the `menu`, `orders`, and `settings` tables and to a complete `pos_state` snapshot. The snapshot includes staff profiles, PINs, active sessions, and sign-in activity. Check the status message in Settings to confirm that the last save succeeded.

Run the complete [Supabase setup script](supabase-setup.sql) in the Supabase SQL Editor before enabling sync. It creates the four tables used by the app, adds the demo access policies and permissions, and enables realtime updates.

The Supabase anon key is designed to be public, so putting it in `supabase-config.js` is expected for a browser app. However, the SQL script's policies are for a front-end demo only: anyone with the project URL and anon key can read or change this state, including staff PINs. Use a trusted backend and real authentication before storing production staff credentials. Never put a service-role key in this file.

## Included

- Search routes by origin and destination, choose a date and passenger count, and create demo tickets
- Station kitchen menu with category filters, cart quantity controls, and pickup linked to a booked departure
- Admin panel for adding/removing bus lines and menu items, and updating food-order status
- Local browser persistence for routes, menu items, tickets, and food orders

## Demo limitations

This is a front-end prototype. It does not process payments, reserve seats across devices, or connect to a real restaurant or bus operator. The admin panel is not protected by authentication, and browser localStorage is not suitable for production data. A production release needs a backend API, persistent database, authenticated passenger/admin accounts, payment integration, and real-time seat/order handling.