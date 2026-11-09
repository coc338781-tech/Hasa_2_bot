# Command documentation contract

Every newly added WhatsApp command must be registered by its plugin module and must appear automatically in all three user-facing command surfaces:

1. .menu category selection (reply with the category number).
2. .list categorized command list.
3. .help detailed guide.

## Registering a command

Export a named `commands` array from the plugin file. Each entry must include:
- `name`: command name without the prefix.
- `category`: one of the existing numbered categories "1" through "10".
- `usage`: full command usage without the prefix, including required arguments.
- `description`: clear explanation and any important requirements.

Example:

```js
export const commands = [{
  name: "newcommand",
  category: "10",
  usage: "newcommand <text>",
  description: "Explains and processes the supplied text"
}];
```

The plugin loader collects these declarations. The core menu, list, and help render them from the same catalog. Do not add a command without its metadata and test coverage.