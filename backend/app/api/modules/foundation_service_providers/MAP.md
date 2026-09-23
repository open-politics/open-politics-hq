```
                        FOUNDATION SERVICE PROVIDERS


            providers.py          primitives.py            resolve.py
         ┌────────────────┐    ┌───────────────┐     ┌──────────────────┐
         │  @provider     │    │  Domain       │     │  resolve()       │
         │  class Ollama: │───►│  Dialect      │────►│  list_models()   │
         │    language=…  │    │  Feature      │     │                  │
         │    embedding=… │    │  Quirks       │     │  ──► Resolved    │
         │    ocr=…       │    │  Binding      │     └──────────────────┘
         └────────────────┘    └───────────────┘              │
            WHAT EXISTS          THE VOCABULARY               ▼
                                                        live provider
                                                              │
      ┌───────────────────────────────────────────────────────┘
      ▼
   ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
   │ language │embedding │  logic   │ geocoding│web_search│ storage  │   ocr    │ scraping │
   ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
   │ blocks   │ indexed  │questions │ osm      │ answer_  │ s3       │ vision_  │ article_ │
   │ turns    │ flat     │ raw      │ geojson  │  engine  │ file     │  prompt  │  parser  │
   │ items    │          │          │          │metasearch│  system  │ local_   │          │
   │          │          │          │          │          │          │  engine  │          │
   └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
        5          4          3          3          2          2          2          1
                              22 endpoints · 8 domains
```

## Every domain, same five files

```
   <domain>/
   ┌──────────────┬────────────────────────────────────────────────┐
   │ base.py      │  the Protocol. What a caller may rely on.      │
   │ models.py    │  the dataclasses. Quirks, results, specs.      │
   │ provider.py  │  X = Domain(...)                               │
   │ dialects/    │  __init__ registers · one module per wire      │
   │ features/    │  __init__ registers · one module per surface   │
   └──────────────┴────────────────────────────────────────────────┘

   top level/
   ┌──────────────┬────────────────────────────────────────────────┐
   │ providers.py │  every declaration                             │
   │ primitives.py│  the vocabulary                                │
   │ resolve.py   │  declaration ──► live object                   │
   │ base.py      │  Adapter: client · headers · url · sse/ndjson  │
   │ models.py    │  ModelSpec                                     │
   │ user_config.py  what a user or infospace chose                │
   └──────────────┴────────────────────────────────────────────────┘
```

## One declaration

```
   @provider
   class Anthropic:
     key      = "anthropic"          ┐
     api_key  = Setting("…")         ├──►  Endpoint      who we talk to
     base_url = Setting("…")         │
     contexts = {"cloud"}            ┘

     language = Language(            ┐
       dialect  = …blocks            │     ──► dialects/blocks.py
       features = [prompt_caching]   ├──►  Binding       ──► features/caching.py
       quirks   = BlocksQuirks(…)    │     ──► quirks.py  (typed to the dialect)
       models   = [LLMModelSpec(…)]  │
     )                               ┘
```

## Which bucket?

```
                  ┌─ needs a new adapter class? ────────► DIALECT
                  │
   a difference ──┼─ adds a method to call? ────────────► FEATURE
                  │
                  ├─ existing code needs an if/else? ───► QUIRK
                  │
                  └─ observable at runtime? ────────────► derive it, declare nothing
```

## Import-time guards

```
   Ocr(dialect=Language.dialects.blocks)   ──►  AssertionError  wrong domain
   langauge = Language(…)                  ──►  AssertionError  wrong attribute
   blocks + TurnsQuirks(…)                 ──►  AssertionError  wrong dialect
   BlocksQuirks(thinking_tags=True)        ──►  TypeError       wire can't read it
   LLMModelSpec(supports_tool=True)        ──►  TypeError       typo
   WIRE_TYPES → outside PLACE_TYPES        ──►  AssertionError  vocabulary drift

                          none of these reach runtime
```

## resolve()

```
   resolve("language", infospace_id=5)

     1  context       infospace.enrichment_config   SELECTABLE_ENRICHERS
                      owner.provider_defaults       fallback, all domains
                           └──► ProviderSelection        one DB round-trip

     2  credentials   runtime_key ────────────► per-call BYOK        ◄── wins
                      owner.encrypted ────────► per-user
                      Setting.read ───────────► deployment key
                         └─ only if foundation.access grants all|superuser
                      nothing ────────────────► ProviderError

     3  construct     dialect module imported NOW, first time
                      missing package ──► ProviderError, not ImportError

     4  features      PROVIDES fns bound on  ──► hasattr(p,"pull_model")

     5  spec          declared ──► dialect baseline.  zero I/O.

                                  ▼
                      Resolved  .model .provider_key .spec
```

## The three language wires

```
                blocks              turns               items
                anthropic           mistral             openai
                llamacpp            ollama
   ───────────────────────────────────────────────────────────────
   unit         role turns          role turns          flat item log
                BLOCK content       STRING content
   tool result  block in a          its own message     sibling item
                USER turn           role:"tool"
   ───────────────────────────────────────────────────────────────
   path         /v1/messages        /chat/completions   /responses
                                    ollama /api/chat


   blocks   assistant [ text │ tool_use ]
            user      [ tool_result │ … ]   ◄── the structural signature

   turns    assistant  content + tool_calls
            tool       one message per result

   items    … │ function_call │ function_call_output │ …   siblings
```

## The two logic wires

```
                questions           raw
                kev                 llamacpp
                typesafe
   ───────────────────────────────────────────────────────────────
   unit         one state,          one state,
                many questions      one question per forward pass
   reads        the server's        next-token logprobs, restricted
                own distribution    to the answer letters
   trained      yes — calibrated    no — any instruct GGUF
   path         /v1/systemone       /completion (+ /apply-template, /tokenize)
   ───────────────────────────────────────────────────────────────

   Both return Readout{scores, kind, mass} and nothing else. Normalising,
   calibrating and naming happen once, in transforms.to_answer — which is why
   the engine cannot tell which wire replied, and why a threshold set on one
   endpoint means the same thing on another.

   A decision is one state and EVERY question about it: questions pack into a
   single request, and a readout walks them over one cached prefix.
```

## Which model a logic endpoint runs

```
   NOT a picker. A decision server loads ONE checkpoint at startup and has no
   endpoint to load another, so the choice is deployment config, not a request
   parameter — and no model is declared on the provider.

   HQ.yml  foundation.providers.kev.run: jaredpalmer/kev-4b
     └─► setup.sh render ─► HQ_KEV_RUN ─► compose KEV_RUN ─► kev.serve --run
                                          (downloads from HF on first boot)

   switching   edit HQ.yml · ./setup.sh render · docker compose up -d kev
               the old weights stay in the kev_models volume, so going back is free

   reading     the `loaded_model` feature (GET /v1/models) reports what is
               actually answering, so the setup UI shows it instead of offering
               a menu the server ignores — the same bargain llama.cpp makes.

   what the model can take — option ceiling, trained state window — is therefore
   a quirk of the ENDPOINT, not a ModelSpec a caller picks.
```

## Calling logic from a task

```
   @task("<name>", check=lambda iid: select(...),   # rows still needing a judgment
         queue="logic", batch=25, max_concurrency=1, self_chain=True,
         capability="logic", tags=frozenset({"logic"}))
   def judge_x(ctx, ids):
       answers = await ctx.provider("logic").judge_many(items)

   where the provider comes from — the ordinary cascade, nothing logic-specific
     owner.provider_defaults.logic   a user's pick, saved from the settings UI
     foundation.use.logic            the deployment's answer for everyone
     neither                         ProviderError ─► @task structural block,
                                     cleared the moment config is saved

   aggregation, three levels, none of them new machinery
     one request   one state, many questions        the dialect's unit
     one task run  judge_many                       Semaphore(quirks.parallel),
                                                    the width the ENDPOINT serves
     across runs   queue="logic"                    celery_worker's -Q list

   A backend that answers one request at a time says so with parallel=1. When a
   consumer starts blocking the shared pool, split the queue onto its own worker
   (--concurrency=1), the way celery_worker_processing already does for ingest.
```

## Add an endpoint

```
   @provider
   class Groq:
       key      = "groq"
       api_key  = Setting("GROQ_API_KEY", label="…", url="…")
       base_url = Setting("GROQ_BASE_URL")
       contexts = {"cloud"}

       language = Language(
           dialect  = Language.dialects.turns,
           features = [Language.features.models_v1],
           quirks   = TurnsQuirks(max_tokens_field="max_completion_tokens"),
       )

   every Setting attr         must be a declared AppSettings field; that
                              field carries the default, Setting never does
   no models=                 an undeclared model still resolves and runs
```

## Add a wire

```
   language/dialects/<name>.py        implement four:

        encode(turn)              ──►  request body
        stream(turn)              ──►  AsyncIterator[Delta]
        encode_history(execs)     ──►  replay prior tool turns
        extend(msgs, reply, execs)──►  append the turn just run

   language/dialects/__init__.py      Language.dialect("<name>", module=…,
                                        adapter=…, path=…, quirks_type=…)
```

## Add a feature

```
   language/features/<name>.py        PROVIDES = ("rerank",)
                                      async def rerank(p, docs): …

   language/features/__init__.py      Language.feature("rerank", module="<name>")

   providers.py                       features=[Language.features.rerank]

   caller                             hasattr(p, "rerank")
```

## Use one

```
   p = resolve("language", infospace_id=5)

   async for snap in await p.generate(msgs, model_name=p.model, stream=True,
                                      options=GenerationOptions(max_tokens=8000)):
       snap.content          ◄── CUMULATIVE, not delta
       snap.tool_executions  ◄── the WHOLE list, every yield, stable ids

   p.spec.supports_tools     ◄── capability, zero I/O
   hasattr(p, "pull_model")  ◄── feature probe, never  key == "ollama"
```

## Streaming invariants

```
   1  await generate(stream=True) ──► a BARE async generator
   2  content is CUMULATIVE                    \n\n-joined across iterations
   3  tool_executions is the WHOLE list        ids stable across yields
   4  each execution   running ──► completed │ failed
   5  iteration present and correct            replay groups by it
   6  model_view written on completed AND failed
   7  the iterator yields AT LEAST once
   8  ChatResponse.content non-nullable        None 500s the SSE route
```

## Provenance

```
   VOCABULARY
     dialect is PACKAGING, never a URL or a vendor          primitives.Dialect
     3 language wires: 2 axes cluster, 7 cut across         above
     one Domain.__call__ for all 7 — the signature IS       primitives.Domain
       the legal-option set
     quirks describe ENDPOINTS, supports_* describes MODELS quirks.py
     quirks typed by the DIALECT that reads them            quirks.py
     path is per-ENDPOINT, not per-dialect                  Binding.path
     declared models RANK, never fence                      resolve.py

   FIXED, 2026-09
     system coalesces to one str OR one flat block list     blocks._split_system
        ["…"] and [[{…}]] were both rejected
     empty filter runs AFTER media attaches                 blocks._drop_empty
        an image-only user turn vanished
     one _tool_result_block for replay and append           blocks.py
        two copies had drifted on is_error and on id
     ollama path /api/chat                                  providers.py
        "404 page not found" on every call
     Setting.read falls back to os.environ                  primitives.Setting
        a missing AppSettings field read as None
     salvage keeps partial results                          embedding/engine.py
     output_schema survives to the wire                     ToolDef
     vision gate before attaching images                    both dialects
     interleaved-thinking beta header                       blocks.py

   PROBED LIVE, not inferred
     llama.cpp /v1/messages emits TYPED thinking + native tool_use
        ⇒ thinking_tags and native_tool_parsing were wrong, deleted
        ⚠ /props says reasoning_format='none' — that is the OpenAI-compat
          path, not this one. The source was not decidable.
     ollama  /chat/completions does not exist · /api/chat does

   REJECTED
     generic Capability with exclusive slots · a LanguageDomain subclass ·
     engine on the declaration · Feature.provides duplicating fns.keys() ·
     wireutil.py — a file named "util" is what you write when you have not
     decided what it is
```
