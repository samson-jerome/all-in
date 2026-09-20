-- pgTAP powers the RLS test suite. It is only needed where tests run;
-- drop this extension before promoting the schema to production.
create extension if not exists pgtap with schema extensions;
