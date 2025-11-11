# 🎨 Clean Architecture PlantUML Diagrams - Viewing Guide

## ✅ Fixed Files

All sequence diagrams have been fixed to resolve PlantUML syntax errors:
- ✅ `07-user-module.puml` - User registration & management flow
- ✅ `08-github-module.puml` - GitHub webhook & API integration flow  
- ✅ `09-container-module.puml` - Container spawning & processing flow
- ✅ `10-deployment-module.puml` - Worker deployment & rollback flow
- ✅ `11-file-loc-breakdown.puml` - Complete file structure (package diagram)

## 🔍 How to View Diagrams

### **Option 1: VS Code with PlantUML Extension (Recommended)**

1. **Extension already installed:** `jebbs.plantuml`

2. **Open any `.puml` file**

3. **Preview diagram:**
   - **macOS**: Press `⌥ + D` (Option + D)
   - **Or**: `Cmd + Shift + P` → type "PlantUML: Preview Current Diagram"

4. **Preview will appear on the right side!**

**Settings configured:**
```json
{
  "plantuml.server": "https://www.plantuml.com/plantuml",
  "plantuml.render": "PlantUMLServer",
  "plantuml.exportFormat": "svg"
}
```

### **Option 2: Export to Images**

Export all diagrams to SVG/PNG:

```bash
# Export to SVG (recommended)
cd docs/diagrams/clean-architecture
for file in *.puml; do
  echo "Exporting $file..."
  # VS Code command will export automatically
done
```

Or use Command Palette: `PlantUML: Export Current Diagram`

### **Option 3: Online Viewer**

1. Copy content of any `.puml` file
2. Go to: https://www.plantuml.com/plantuml/uml/
3. Paste and view

### **Option 4: PlantUML Web Server**

```bash
# Using Docker
docker run -d -p 8080:8080 plantuml/plantuml-server:jetty

# Then open: http://localhost:8080
```

## 📊 Diagram Overview

| File | Type | Description | LOC Info |
|------|------|-------------|----------|
| `07-user-module.puml` | Sequence | User registration complete flow | 1,060 LOC |
| `08-github-module.puml` | Sequence | Webhook processing & GitHub API | 1,270 LOC |
| `09-container-module.puml` | Sequence | Container spawn & prompt processing | 2,309 LOC |
| `10-deployment-module.puml` | Sequence | Worker deployment & rollback | 1,510 LOC |
| `11-file-loc-breakdown.puml` | Package | Complete 68-file structure | 7,520 LOC total |

## 🔧 What Was Fixed

**Problem:** PlantUML doesn't support mixing `sequence diagram` syntax with `package/component` syntax in the same file.

**Solution:** Converted component details sections to `note over` blocks that work in sequence diagrams.

**Before:**
```plantuml
deactivate Routes

== Component Details ==
package "User Module Files" {
  component "Routes" as R1 { ... }
  component "Controller" as R2 { ... }
}
note bottom
  Summary...
end note
```

**After:**
```plantuml
deactivate Routes

note over Client, Crypto
  **User Module Summary**
  Files structure and details...
end note
```

## 🎯 Quick Start

1. **Reload VS Code:** `Cmd + Shift + P` → "Developer: Reload Window"
2. **Open:** `07-user-module.puml`
3. **Preview:** Press `Option + D`
4. **Navigate:** Open other `.puml` files and preview

## 💡 Tips

- **Zoom:** Use mouse wheel in preview
- **Export:** Right-click preview → "Export"
- **Refresh:** If preview doesn't update, close and reopen preview
- **Dark mode:** PlantUML diagrams adapt to VS Code theme

## 🐛 Troubleshooting

**If preview shows error:**
1. Check `.vscode/settings.json` exists with PlantUML server config
2. Reload VS Code window
3. Try online viewer as fallback

**If preview is blank:**
1. Wait a few seconds (server rendering)
2. Check internet connection (using online server)
3. Try exporting instead of preview

## 📚 Related Documentation

- Main README: `docs/diagrams/clean-architecture/README.md`
- DDD Analysis: `docs/WHY_NOT_DDD.md`
- Migration Plan: See diagram `15-migration-phases.puml`

---

**Last Updated:** October 21, 2025  
**Status:** ✅ All syntax errors fixed
