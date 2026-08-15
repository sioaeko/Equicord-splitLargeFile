(*
FileSplitter Patcher
Copyright (c) 2026 sioaeko and contributors
SPDX-License-Identifier: GPL-3.0-or-later
*)
on replace_text(findText, replaceText, sourceText)
	set oldTIDs to AppleScript's text item delimiters
	set AppleScript's text item delimiters to findText
	set textItems to text items of sourceText
	set AppleScript's text item delimiters to replaceText
	set resultText to textItems as string
	set AppleScript's text item delimiters to oldTIDs
	return resultText
end replace_text

on escape_json(value)
	set value to replace_text("\\", "\\\\", value)
	set value to replace_text("\"", "\\\"", value)
	set value to replace_text(return, "\\n", value)
	return value
end escape_json

set modeChoices to {"Installed Equicord (compatibility patch)", "Installed Vencord (compatibility patch)", "Source Repo (Vencord - preferred)", "Source Repo (Equicord - preferred)"}
set selectedMode to choose from list modeChoices with prompt "Choose where to install FileSplitter" default items {"Installed Equicord (compatibility patch)"} without multiple selections allowed and empty selection allowed
if selectedMode is false then return

set modeLabel to item 1 of selectedMode
if modeLabel is "Installed Equicord (compatibility patch)" then
	set modeKey to "installed"
	set sourceFlavor to ""
	set actionChoices to {"Install / Update", "Status", "Restore"}
	set defaultFolder to POSIX file ((POSIX path of (path to home folder)) & "Library/Application Support/Equicord")
else if modeLabel is "Source Repo (Vencord - preferred)" then
	set modeKey to "source"
	set sourceFlavor to "vencord"
	set actionChoices to {"Install / Update", "Status"}
	set defaultFolder to path to desktop folder
else if modeLabel is "Installed Vencord (compatibility patch)" then
	set modeKey to "installed-vencord"
	set sourceFlavor to ""
	set actionChoices to {"Install / Update", "Status", "Restore"}
	set defaultFolder to POSIX file ((POSIX path of (path to home folder)) & "Library/Application Support/Vencord")
else
	set modeKey to "source"
	set sourceFlavor to "equicord"
	set actionChoices to {"Install / Update", "Status"}
	set defaultFolder to path to desktop folder
end if

set selectedAction to choose from list actionChoices with prompt "Choose action" default items {"Install / Update"} without multiple selections allowed and empty selection allowed
if selectedAction is false then return

set actionLabel to item 1 of selectedAction
if actionLabel is "Install / Update" then
	set actionKey to "install"
else if actionLabel is "Status" then
	set actionKey to "status"
else
	set actionKey to "restore"
end if

set riskAccepted to "false"
if actionKey is "install" then
	set riskDialog to display dialog ("FileSplitter is an unofficial project. Client modifications may violate Discord's Terms and may risk account enforcement. Installed modes modify local client files. Only share files you are authorized to send." & return & return & "Continue only if you understand and accept responsibility.") with title "FileSplitter Patcher" buttons {"Cancel", "I Understand"} default button "Cancel" with icon caution
	if button returned of riskDialog is not "I Understand" then return
	set riskAccepted to "true"
end if

set chosenFolder to choose folder with prompt "Select the target folder" default location defaultFolder
set chosenPath to POSIX path of chosenFolder

set restartValue to "false"
if modeKey is "installed" or modeKey is "installed-vencord" then
	set restartDialog to display dialog "Restart Discord automatically after install or restore?" with title "FileSplitter Patcher" buttons {"No", "Yes"} default button "Yes"
	if button returned of restartDialog is "Yes" then set restartValue to "true"
end if

set json to "{\"action\":\"" & actionKey & "\",\"mode\":\"" & modeKey & "\",\"path\":\"" & escape_json(chosenPath) & "\",\"restartClient\":" & restartValue & ",\"riskAccepted\":" & riskAccepted
if sourceFlavor is not "" then
	set json to json & ",\"sourceFlavor\":\"" & sourceFlavor & "\""
end if
set json to json & "}"
return json
