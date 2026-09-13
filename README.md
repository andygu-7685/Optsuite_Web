# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI for uploading source
images. Scoring returns a `(group, element)` pair.

## Python scorer

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

`itk-elastix` is an extra dependency, needed only when `PT_TRANSFORM = "elastix"`
in [usaf_registration/constants.py](usaf_registration/constants.py):

```bash
pip install itk-elastix
```

## Web frontend

Apply [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor first
(creates the table, bucket, and RLS policies), then:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Fill in `.env` with your Supabase project URL and anon key.
