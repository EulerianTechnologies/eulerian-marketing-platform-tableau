# Installation

## 1. Get the connector

Download `eulerian-marketing-platform-<version>.taco` from the
[GitHub releases](https://github.com/EulerianTechnologies/eulerian-marketing-platform-tableau/releases),
or build it from source (see [Build from source](../README.md#build-from-source)).

## 2. Tableau Desktop (2025.2 or later)

Copy the `.taco` file to your connectors folder:

| OS | Folder |
|---|---|
| Windows | `C:\Users\<you>\Documents\My Tableau Repository\Connectors` |
| macOS | `/Users/<you>/Documents/My Tableau Repository/Connectors` |

Restart Tableau Desktop. **Eulerian Marketing Platform** appears under *Connect > To a Server > More…*.

### Unsigned builds

Tableau only loads signed connectors by default. To run a build that is not signed (for example one built
from source), disable signature verification **on a test machine only**:

```
# Windows
"C:\Program Files\Tableau\Tableau <version>\bin\tableau.exe" -DDisableVerifyConnectorPluginSignature=true
# macOS
open -n /Applications/Tableau\ Desktop\ <version>.app --args -DDisableVerifyConnectorPluginSignature=true
```

## 3. Tableau Server

1. Copy the `.taco` file to every node, into `<Tableau Server data dir>/tabsvc/vizqlserver/Connectors`
   (create the folder if it does not exist).
2. Unsigned build only (test environments):
   `tsm configuration set -k native_api.disable_verify_connector_plugin_signature -v true --force-keys`
3. `tsm pending-changes apply`

Scheduled extract refreshes re-run the query with the token stored in Tableau Server's keychain.

## 4. Tableau Cloud

Tableau Cloud does not accept connector files uploaded by its users. Running this connector there
requires distribution through Tableau's partner program (Tableau Exchange). Check Tableau's current
policy before you plan a Cloud rollout.

## 5. Network

Tableau (Desktop, or Server for refreshes) must reach the Eulerian API over HTTPS (443):
`*.api.eulerian.com`, `*.api.eulerian.ca` or `*.api.gouv.eulerian.fr`.
Those are the only domains the connector is allowed to call (`connector.json` > `permission`).

## 6. API token

Create a token in the Eulerian interface. It needs read access to the websites you want to report on.
The token is only typed into the connector dialog. Tableau keeps it as a secret, outside the workbook.
