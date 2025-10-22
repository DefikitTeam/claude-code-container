## EXACT PROJECT STRUCTURE

```
src/                                         # NEW CLEAN ARCHITECTURE
│
├── core/                                    # 1,650 LOC (21 files)
│   ├── entities/                            # 300 LOC (4 files)
│   │   ├── user.entity.ts                   # 80 LOC
│   │   ├── installation.entity.ts           # 70 LOC
│   │   ├── container-config.entity.ts       # 90 LOC
│   │   └── deployment.entity.ts             # 60 LOC
│   │
│   ├── use-cases/                           # 1,220 LOC (16 files)
│   │   ├── user/                            # 310 LOC
│   │   │   ├── register-user.use-case.ts    # 120 LOC
│   │   │   ├── update-user.use-case.ts      # 80 LOC
│   │   │   ├── delete-user.use-case.ts      # 60 LOC
│   │   │   └── get-user.use-case.ts         # 50 LOC
│   │   │
│   │   ├── github/                          # 410 LOC
│   │   │   ├── process-webhook.use-case.ts  # 150 LOC
│   │   │   ├── fetch-repositories.use-case.ts # 90 LOC
│   │   │   ├── fetch-branches.use-case.ts   # 70 LOC
│   │   │   └── create-pull-request.use-case.ts # 100 LOC
│   │   │
│   │   ├── container/                       # 350 LOC
│   │   │   ├── spawn-container.use-case.ts  # 130 LOC
│   │   │   ├── process-prompt.use-case.ts   # 110 LOC
│   │   │   ├── get-logs.use-case.ts         # 50 LOC
│   │   │   └── terminate-container.use-case.ts # 60 LOC
│   │   │
│   │   └── deployment/                      # 350 LOC
│   │       ├── deploy-worker.use-case.ts    # 140 LOC
│   │       ├── get-status.use-case.ts       # 60 LOC
│   │       ├── rollback.use-case.ts         # 80 LOC
│   │       └── validate-config.use-case.ts  # 70 LOC
│   │
│   └── interfaces/                          # 130 LOC (7 files)
│       ├── repositories/                    # 40 LOC
│       │   ├── user.repository.ts           # 20 LOC
│       │   └── deployment.repository.ts     # 20 LOC
│       │
│       └── services/                        # 90 LOC
│           ├── github.service.ts            # 25 LOC
│           ├── token.service.ts             # 15 LOC
│           ├── crypto.service.ts            # 15 LOC
│           ├── container.service.ts         # 20 LOC
│           └── deployment.service.ts        # 15 LOC
│
├── infrastructure/                          # 3,450 LOC (13 files)
│   ├── durable-objects/                     # 1,500 LOC (4 files)
│   │   ├── user-config.do.ts                # 350 LOC - implements IUserRepository
│   │   ├── github-app-config.do.ts          # 300 LOC
│   │   ├── acp-session.do.ts                # 400 LOC
│   │   └── container.do.ts                  # 450 LOC - implements IContainerService
│   │
│   ├── services/                            # 1,000 LOC (4 files)
│   │   ├── github.service.impl.ts           # 280 LOC - implements IGitHubService
│   │   ├── token.service.impl.ts            # 200 LOC - implements ITokenService
│   │   ├── crypto.service.impl.ts           # 180 LOC - implements ICryptoService
│   │   └── deployment.service.impl.ts       # 340 LOC - implements IDeploymentService
│   │
│   ├── repositories/                        # 150 LOC (1 file)
│   │   └── deployment-repository.impl.ts    # 150 LOC
│   │
│   ├── adapters/                            # 300 LOC (2 files)
│   │   ├── cloudflare-api.adapter.ts        # 200 LOC
│   │   └── wrangler.wrapper.ts              # 100 LOC
│   │
│   └── external/                            # 500 LOC (1 file)
│       └── token-manager.ts                 # 500 LOC
│
├── api/                                     # 1,770 LOC (25 files)
│   ├── controllers/                         # 600 LOC (5 files)
│   │   ├── user.controller.ts               # 150 LOC
│   │   ├── github.controller.ts             # 130 LOC
│   │   ├── container.controller.ts          # 120 LOC
│   │   ├── deployment.controller.ts         # 140 LOC
│   │   └── installation.controller.ts       # 60 LOC
│   │
│   ├── routes/                              # 300 LOC (6 files)
│   │   ├── user.routes.ts                   # 60 LOC
│   │   ├── github.routes.ts                 # 50 LOC
│   │   ├── container.routes.ts              # 50 LOC
│   │   ├── deployment.routes.ts             # 70 LOC
│   │   ├── installation.routes.ts           # 40 LOC
│   │   └── health.routes.ts                 # 30 LOC
│   │
│   ├── middleware/                          # 470 LOC (5 files)
│   │   ├── auth.middleware.ts               # 120 LOC
│   │   ├── validation.middleware.ts         # 100 LOC
│   │   ├── error.middleware.ts              # 90 LOC
│   │   ├── cors.middleware.ts               # 70 LOC
│   │   └── rate-limit.middleware.ts         # 90 LOC
│   │
│   ├── dto/                                 # 300 LOC (7 files)
│   │   ├── register-user.dto.ts             # 40 LOC
│   │   ├── update-user.dto.ts               # 30 LOC
│   │   ├── spawn-container.dto.ts           # 40 LOC
│   │   ├── process-prompt.dto.ts            # 40 LOC
│   │   ├── deploy-worker.dto.ts             # 50 LOC
│   │   ├── webhook-payload.dto.ts           # 60 LOC
│   │   └── create-pr.dto.ts                 # 40 LOC
│   │
│   └── responses/                           # 100 LOC (3 files)
│       ├── success.response.ts              # 30 LOC
│       ├── error.response.ts                # 40 LOC
│       └── paginated.response.ts            # 30 LOC
│
├── shared/                                  # 500 LOC (8 files)
│   ├── types/                               # 200 LOC (2 files)
│   │   ├── index.ts                         # 150 LOC
│   │   └── common.types.ts                  # 50 LOC
│   │
│   ├── errors/                              # 150 LOC (4 files)
│   │   ├── base.error.ts                    # 50 LOC
│   │   ├── validation.error.ts              # 40 LOC
│   │   ├── not-found.error.ts               # 30 LOC
│   │   └── unauthorized.error.ts            # 30 LOC
│   │
│   └── utils/                               # 150 LOC (2 files)
│       ├── crypto.util.ts                   # 80 LOC
│       └── validation.util.ts               # 70 LOC
│
└── index.ts                                 # 150 LOC - Entry point + DI

TOTAL: 68 files, 7,520 LOC
```

---

## 📈 5. METRICS & COMPARISON

### **Current (Monolithic)**
- Files: 15
- LOC: 7,276
- Avg LOC/file: 485
- Test coverage: ~30%
- Issues: God objects, tight coupling

### **Target (Clean Architecture)**
- Files: 68
- LOC: 7,520
- Avg LOC/file: 111
- Test coverage: 80%
- Benefits: Clean separation, testable

### **Improvement**
- **4.4x** more files (better organization)
- **4.4x** smaller files (easier to read)
- **2.7x** test coverage (better quality)
- **3-5x** productivity (after migration)

---

## 💰 6. COST-BENEFIT SUMMARY

### **Implementation**
- **Time:** 6 weeks
- **Cost:** $15k-$25k
- **Risk:** Medium (incremental)

### **Savings vs DDD**
- **Upfront:** $35k-$75k
- **Annual:** $32k-$48k
- **3-year TCO:** $130k-$220k

### **ROI**
- **Break-even:** 3-4 weeks
- **Long-term:** 3-5x productivity
- **Team:** 1-2 weeks onboarding (vs 3-6 months for DDD)