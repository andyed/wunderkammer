# A wall from Apple Photos

Two commands turn a Mac's Photos library into a wall of one subject: a pet,
a person, a place, a trip.

```bash
uv tool install osxphotos        # or: pipx install osxphotos
python3 scripts/photos-collection.py --caption dog --label Dog --animal dog --alone \
    --since 2022 --title 'Biscuit' --item Biscuit --items Biscuit --out ~/biscuit-wall
node scripts/show-collection.mjs ~/biscuit-wall/collection.json
```

The second command prints three links: the wall, the same wall arriving as
the image warehouse ("Biscuit. Lots of Biscuit."), and the comparison page. Open
one. To make a video of the warehouse:

```bash
node scripts/warehouse-video.mjs --collection ~/biscuit-wall/collection.json --view 'group=year' --walk 3 --out biscuit.mp4
```

## What it reads

[osxphotos](https://github.com/RhetTbull/osxphotos) reads the Photos library
read-only. A photo is wanted when it matches any of:

- `--label`: Photos' own image labels, such as `Dog`, `Beach` or `Sunset`.
- `--caption`: a word in the caption Photos writes for each photo (macOS 27
  and later). It matches whole words and their plural, so `dog` finds "a dog's
  toy" and "two dogs", and not "a hotdog stand".
- `--person`: a person or pet named in People & Pets.
- `--album`, `--keyword`.

`--since` and `--until` take `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.

## How it tidies

Each step's count is printed, and `selection.json` gives every matching
photo's reason for being left out.

1. **Not yours, or not a photo:** screenshots and screen recordings; photos
   shared with you through shared albums or Messages; pictures with no camera
   in their metadata (saved, downloaded or generated images); photos with no
   image on this Mac; and photos under Photos' own quality score floor
   (`--min-score`, 0.2).
2. **The subject must be seen** (`--animal dog` or `cat`). Apple's Vision
   framework runs on this Mac and finds each dog or cat with the share of the
   frame it covers. A photo is kept when the animal covers `--min-area`
   (0.03) or more. Vision misses a face that fills the frame, so a photo where
   it finds nothing is kept when Photos' caption calls it a close-up of the
   animal or Photos labelled one. `--alone` also leaves out photos with more
   than one. This step needs Swift, which comes with Xcode or its command line
   tools.
3. **One per moment:** of shots taken within `--gap` seconds (90) of each
   other, the favourite is kept, else the best by Photos' quality score.
4. **Spread over time:** `--limit` (150) photos, a round at a time across the
   months, so every stretch of time is there, best first.

After a look at the wall, `--exclude photos:<id>` leaves out a photo (the id
is in `selection.json` and in each item's link), and running again fills its
place.

## What it writes

- `covers/` at 480 px and `photos/` at 1,600 px, from Photos' own previews
  (edits included), so originals kept only in iCloud need no download.
- The images carry no metadata: no location, camera or faces.
- `collection.json`, with the attributes year, season, setting (beach,
  water, woods, couch and bed, grass and garden … from Photos' labels),
  people, time of day, colour, favourite and orientation. `--places` adds the
  place name Photos gives each photo; it is left out by default.
- Titles are Photos' captions.
- `ui.nouns` comes from `--item` and `--items`. The wall counts in them, and
  the warehouse's caption says them.

Nothing leaves the Mac. `show-collection.mjs` serves on 127.0.0.1 only.

## When it does not work

- **"no such table"** from osxphotos: the Photos database changed with the
  macOS release. `uv tool upgrade osxphotos`; 0.77.2 reads macOS 27.
- **osxphotos cannot open the library:** give the terminal Full Disk Access
  in System Settings > Privacy & Security.
- **Few matches:** captions arrive with macOS 27; before it, use `--label`
  (Photos' labels go back years) or name the pet in People & Pets and use
  `--person`.

## Verification

`tests/test_photos_collection.py` covers what is left out and why, the
one-per-moment rule, the spread over months, the animal rules, caption word
matching, the date forms, and a whole build that must validate and carry no
image metadata. `python3 scripts/check-photos-mutations.py` removes six of
those protections in turn (metadata stripping, places off by default, shared
and screenshot exclusion, the close-up rule and `--alone`) and shows the tests
failing.
