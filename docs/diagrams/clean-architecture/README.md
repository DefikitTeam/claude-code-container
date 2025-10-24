# Clean Architecture Diagrams

This directory contains PlantUML diagrams for the proposed Clean Architecture refactoring of the Claude Code Containers project.

## 📊 Diagram Overview

### 1. Overview & Comparison
- **01-clean-architecture-overview.puml** - High-level Clean Architecture layers
- **02-current-vs-proposed.puml** - Side-by-side comparison of current vs new structure
- **03-dependency-flow.puml** - Dependency inversion principle visualization

### 2. Layer Details
- **04-core-layer.puml** - Entities, Use Cases, and Interfaces
- **05-infrastructure-layer.puml** - Durable Objects, Services implementation
- **06-api-layer.puml** - Controllers, Routes, Middleware, DTOs

### 3. Module Designs
- **07-user-module.puml** - User management module structure
- **08-github-module.puml** - GitHub integration module structure
- **09-container-module.puml** - Container management module structure
- **10-deployment-module.puml** - Deployment module structure

### 4. Detailed Designs
- **11-file-loc-breakdown.puml** - LOC estimation for all files
- **12-dependency-graph.puml** - Inter-module dependencies
- **13-data-flow.puml** - Request/Response flow through layers
- **14-error-handling.puml** - Error propagation strategy

### 5. Migration Plan
- **15-migration-phases.puml** - Step-by-step refactoring phases
- **16-testing-strategy.puml** - Testing approach per layer

## 🎨 Styling

All diagrams use consistent styling:
- **Blue (#3498db)**: Core/Domain layer
- **Green (#2ecc71)**: Infrastructure layer
- **Orange (#f39c12)**: API layer
- **Purple (#9b59b6)**: Shared utilities
- **Red (#e74c3c)**: Current architecture issues

## 🔧 How to View

### VS Code (Recommended)
1. Install **PlantUML** extension by jebbs
2. Open any `.puml` file
3. Press `Alt + D` (Windows/Linux) or `Option + D` (Mac)

### Online
Visit: http://www.plantuml.com/plantuml/uml/

### Command Line
```bash
# Generate all diagrams as PNG
find . -name "*.puml" -exec plantuml {} \;

# Generate as SVG (better quality)
find . -name "*.puml" -exec plantuml -tsvg {} \;
```

## 📐 Standards

### File Naming
- Prefix with number for ordering
- Use kebab-case
- Descriptive names

### Content Structure
```plantuml
@startuml Title
' Include common styling
!include ../_style-common.puml

' Your diagram content

@enduml
```

## 🎯 Use Cases

- **For Developers**: Understand new architecture before refactoring
- **For Code Review**: Reference during PR reviews
- **For Documentation**: Onboarding and architecture decisions
- **For Planning**: Estimate effort and identify dependencies

## 📝 Notes

- All LOC estimates are based on current codebase analysis
- Diagrams should be updated as implementation progresses
- Keep diagrams in sync with actual code structure
