import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui

Panel {
  id: root
  moduleName: "literaryuniverse.companion"
  ipcTarget: "literaryuniverse.companion"
  // The host owns plugin IPC; this avoids duplicate handlers across monitors.
  manageIpc: false
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }
  readonly property Item panelContent: panel.loadedContent
  property var snapshot: ({ signedIn: false })
  property string errorCode: ""
  property double nextRefresh: 0
  property var queue: []
  property var current: ({})
  property bool loadingDraft: false
  property bool dirtyDraft: false
  property string taskId: ""
  property bool accountMenuOpen: false
  readonly property bool busy: bridge.running
  readonly property var editor: panel.loadedContent ? panel.loadedContent.editor : null
  readonly property int unread: snapshot.notifications ? snapshot.notifications.items.filter(function(n) { return !n.read }).length : 0

  function invoke(action, args) {
    if (Date.now() < nextRefresh && action !== "draft" && action !== "open") { errorCode = "rate_limited"; return }
    var item = Object.assign({action: action, userId: snapshot.userId}, args || {})
    // Coalesce draft saves so typing cannot build an unbounded queue.
    if (action === "draft") queue = queue.filter(function(q) { return q.action !== "draft" })
    if (action === "refresh" && (busy || queue.length)) return
    queue = queue.concat([item])
    pump()
  }
  function pump() {
    if (busy || !queue.length) return
    current = queue[0]
    queue = queue.slice(1)
    errorCode = ""
    bridge.stdinEnabled = true
    bridge.running = true
  }
  function refresh(background) {
    if (Date.now() < nextRefresh) return
    invoke("refresh", {background: background, diaryLabel: strings.t("diary"), messageLabel: strings.t("messageBanner"), releaseLabel: strings.t("releaseBanner"), preferences: {
      diary: setting("diaryReminders", false), messages: setting("messageBanners", false), releases: setting("releaseBanners", false)
    }})
  }
  function apply(line) {
    var result
    try { result = JSON.parse(line) } catch (_) { errorCode = "response"; return }
    if (result.error) {
      if (result.error === "signed_out") {
        // Save the outgoing account's unsent typing before removing its view.
        if (!result.pending && dirtyDraft && editor && snapshot.userId) invoke("draft", {text: editor.text, userId: snapshot.userId})
        snapshot = {signedIn: false}
        if (editor) { loadingDraft = true; editor.text = ""; loadingDraft = false }
        dirtyDraft = false
      }
      else errorCode = result.error
      if (result.pending) snapshot = Object.assign({}, snapshot, {pending: true})
      if (result.retryAfter) nextRefresh = Date.now() + result.retryAfter * 1000
      return
    }
    if (result.draftSaved) { dirtyDraft = (editor && editor.text !== current.text) || queue.some(function(q) { return q.action === "draft" }); return }
    if (result.signedIn !== undefined) {
      var accountChanged = snapshot.userId !== result.userId
      if (accountChanged || !result.signedIn) accountMenuOpen = false
      snapshot = result
      if (result.errors && result.errors.length) errorCode = "unavailable: " + result.errors.join(", ")
      if (result.retryAfter) nextRefresh = Date.now() + result.retryAfter * 1000
      if (current.action === "taskAdd" && panel.loadedContent && panel.loadedContent.taskEditor.text === current.text) { panel.loadedContent.taskEditor.text = ""; taskId = "" }
      if (editor && (!dirtyDraft || accountChanged || current.action === "capture" || !result.signedIn)) {
        loadingDraft = true
        editor.text = result.draft || ""
        loadingDraft = false
        dirtyDraft = false
      }
    }
  }
  function openPath(path) { invoke("open", {path: path}) }
  Process {
    id: bridge
    command: ["node", Qt.resolvedUrl("src/bridge.mjs").toString().replace(/^file:\/\//, "")]
    stdinEnabled: true
    onStarted: { write(JSON.stringify(root.current) + "\n"); stdinEnabled = false }
    stdout: SplitParser { onRead: function(line) { root.apply(line) } }
    onExited: Qt.callLater(root.pump)
  }
  Timer { interval: 60000; repeat: true; running: root.snapshot.signedIn && root.setting("backgroundRefresh", true); onTriggered: root.refresh(true) }
  Component.onCompleted: refresh(false)
  onOpenedChanged: {
    accountMenuOpen = false
    if (opened) refresh(false)
    else if (dirtyDraft && editor && snapshot.userId && !snapshot.pending && !(busy && current.action === "capture"))
      invoke("draft", {text: editor.text})
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    active: root.opened
    iconComponent: Component {
      LuLogo { color: button.active && button.useActiveColor ? button.activeColor : button.foreground }
    }
    labelText: root.unread ? Commons.I18n.formatNumber(root.unread) : ""
    tooltipText: "Literary Universe"
    onPressed: root.toggle()
  }
  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    contentWidth: fittedContentWidth(Style.space(420))
    contentHeight: fittedContentHeight(loadedContentHeight, Style.space(720))
    content: FocusScope {
      id: content
      property alias editor: capture
      property alias taskEditor: newTask
      implicitHeight: column.implicitHeight
      Keys.onEscapePressed: root.close()
      Controls.ScrollView {
        id: scroll
        anchors.fill: parent
        contentWidth: availableWidth
        ColumnLayout {
          id: column
          width: scroll.availableWidth
          spacing: Style.spacing.md
          RowLayout {
            Layout.fillWidth: true
            LuLogo { color: Commons.Color.accent; Layout.preferredWidth: Style.space(28); Layout.preferredHeight: Style.space(28) }
            PlainText { text: "Literary Universe"; font.pixelSize: Style.font.subtitle; Layout.fillWidth: true }
            Button { foreground: Commons.Color.popups.text; text: strings.t("refresh"); focusable: true; enabled: !root.busy; onClicked: root.refresh(false) }
          }
          PlainText { visible: root.busy; text: strings.t("loading"); Layout.fillWidth: true }
          PlainText { visible: root.errorCode !== ""; text: strings.t("error") + " (" + root.errorCode + ")"; Layout.fillWidth: true }
          Button { foreground: Commons.Color.popups.text; visible: !root.snapshot.signedIn; text: strings.t("login"); focusable: true; enabled: !root.busy; onClicked: root.invoke("login") }
          ColumnLayout {
            visible: root.snapshot.signedIn
            Layout.fillWidth: true
            spacing: Style.spacing.md
            RowLayout {
              Layout.fillWidth: true
              Button {
                foreground: Commons.Color.popups.text
                text: ((root.snapshot.account ? root.snapshot.account.username : root.snapshot.userId) || "") + (root.accountMenuOpen ? " ▴" : " ▾")
                focusable: true
                Layout.fillWidth: true
                onClicked: root.accountMenuOpen = !root.accountMenuOpen
              }
            }
            ColumnLayout {
              visible: root.accountMenuOpen
              Layout.fillWidth: true
              Button { foreground: Commons.Color.popups.text; text: strings.t("logout"); focusable: true; enabled: !root.busy && !root.dirtyDraft; onClicked: root.invoke("logout") }
            }
            RowLayout {
              Layout.fillWidth: true
              // The helper downloads and checks covers; this only shows its private local copy.
              Image {
                Layout.preferredWidth: Style.space(54)
                Layout.preferredHeight: Style.space(81)
                source: root.snapshot.resume && /^file:\/\//.test(root.snapshot.resume.cover || "") ? root.snapshot.resume.cover : ""
                sourceSize.width: Style.space(108)
                sourceSize.height: Style.space(162)
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                visible: status === Image.Ready
              }
              ColumnLayout {
                Layout.fillWidth: true
                PlainText { visible: !!root.snapshot.resume; text: root.snapshot.resume ? root.snapshot.resume.title : ""; maximumLineCount: 1; elide: Text.ElideRight; Layout.fillWidth: true }
                Button { foreground: Commons.Color.popups.text; text: strings.t("continue"); focusable: true; onClicked: root.openPath(root.snapshot.resume ? root.snapshot.resume.path : "/workshop") }
              }
            }
            PanelSeparator { foreground: Commons.Color.popups.text; Layout.fillWidth: true }
            PlainText { text: strings.t("scratchpad"); font.bold: true }
            PlainText { text: root.snapshot.scratchpad ? root.snapshot.scratchpad.text : ""; maximumLineCount: 4; elide: Text.ElideRight; Layout.fillWidth: true }
            // Omarchy's kit has no multiline editor. Use the Qt control with its palette and spacing.
            Controls.TextArea {
              id: capture
              Layout.fillWidth: true
              Layout.preferredHeight: Style.space(110)
              wrapMode: TextEdit.Wrap
              textFormat: TextEdit.PlainText
              color: Commons.Color.popups.text
              selectionColor: Style.selectionFillFor(Commons.Color.popups.text, Commons.Color.accent)
              selectedTextColor: Commons.Color.popups.text
              leftPadding: Style.spacing.controlPaddingX + Border.left(captureBorder.borderSpec)
              rightPadding: Style.spacing.controlPaddingX + Border.right(captureBorder.borderSpec)
              topPadding: Style.spacing.inputPaddingY + Border.top(captureBorder.borderSpec)
              bottomPadding: Style.spacing.inputPaddingY + Border.bottom(captureBorder.borderSpec)
              font.family: Style.font.family
              font.pixelSize: Style.font.body
              placeholderText: strings.t("capture")
              placeholderTextColor: Qt.darker(Commons.Color.popups.text, 1.6)
              enabled: !root.snapshot.pending && !(root.busy && root.current.action === "capture")
              background: BorderSurface {
                id: captureBorder
                color: Style.controlFill(capture.activeFocus, capture.hovered, Commons.Color.popups.text, Commons.Color.accent)
                borderSpec: Border.controlSpec(capture.activeFocus ? "focus" : (capture.hovered ? "hover-cursor" : "normal"), Commons.Color.popups.text, Commons.Color.accent)
                radius: Style.cornerRadius
              }
              Component.onCompleted: { root.loadingDraft = true; text = root.snapshot.draft || ""; root.loadingDraft = false }
              onTextChanged: if (!root.loadingDraft && root.snapshot.signedIn) { root.dirtyDraft = true; draftTimer.restart() }
              Keys.onPressed: function(event) { if (saveCapture.enabled && event.key === Qt.Key_Return && event.modifiers & Qt.ControlModifier) { saveCapture.clicked(); event.accepted = true } }
              Timer { id: draftTimer; interval: 400; onTriggered: root.invoke("draft", {text: capture.text}) }
            }
            PlainText { visible: !!root.snapshot.pending; text: strings.t("pending"); Layout.fillWidth: true }
            Button { foreground: Commons.Color.popups.text; id: saveCapture; text: strings.t("save"); focusable: true; enabled: !root.busy && capture.text.trim() !== ""; onClicked: { draftTimer.stop(); root.invoke("capture", {text: capture.text}) } }
            PanelSeparator { foreground: Commons.Color.popups.text; Layout.fillWidth: true }
            PlainText { text: strings.t("diary"); font.bold: true }
            Repeater {
              model: root.snapshot.diary ? root.snapshot.diary.entries || [] : []
              RowLayout {
                required property var modelData
                Layout.fillWidth: true
                PlainText {
                  text: new Date(modelData.date + "T12:00:00").toLocaleDateString(Qt.locale(Commons.I18n.formatLocale), Locale.LongFormat)
                  Layout.fillWidth: true
                }
                Button { foreground: Commons.Color.popups.text; text: strings.t(modelData.started ? "continue" : "start"); focusable: true; onClicked: root.openPath(modelData.path) }
              }
            }
            Button { foreground: Commons.Color.popups.text; visible: !!root.snapshot.diary && root.snapshot.diary.due; text: strings.t("snooze"); focusable: true; enabled: !root.busy; onClicked: root.invoke("snooze") }
            PanelSeparator { foreground: Commons.Color.popups.text; Layout.fillWidth: true }
            PlainText { text: strings.t("tasks"); font.bold: true }
            RowLayout {
              Layout.fillWidth: true
              TextField { foreground: Commons.Color.popups.text; id: newTask; enabled: !root.busy; onTextEdited: root.taskId = ""; Layout.fillWidth: true; maximumLength: 500; placeholderText: strings.t("tasks") }
              Button { foreground: Commons.Color.popups.text; text: strings.t("add"); focusable: true; enabled: !root.busy && newTask.text.trim() !== ""; onClicked: { root.invoke("taskAdd", { id: root.taskId || (root.taskId = "desktop-" + Date.now() + "-" + Math.random().toString(36).slice(2)), text: newTask.text }) } }
            }
            Repeater {
              model: root.snapshot.tasks || []
              RowLayout {
                required property var modelData
                Layout.fillWidth: true
                PlainText { text: modelData.title + (modelData.dueDate ? " · " + modelData.dueDate : ""); Layout.fillWidth: true }
                Button { foreground: Commons.Color.popups.text; text: strings.t("done"); focusable: true; enabled: !root.busy; onClicked: root.invoke("taskComplete", {id: modelData.id, version: modelData.version}) }
              }
            }
            PanelSeparator { foreground: Commons.Color.popups.text; Layout.fillWidth: true }
            PlainText { text: strings.t("notifications"); font.bold: true }
            PlainText { visible: !!root.snapshot.notifications && !root.snapshot.notifications.available; text: strings.t("unavailable"); Layout.fillWidth: true }
            Repeater {
              model: root.snapshot.notifications ? root.snapshot.notifications.items.slice(0, 3) : []
              RowLayout {
                required property var modelData
                Layout.fillWidth: true
                PlainText { text: modelData.title; font.bold: !modelData.read; Layout.fillWidth: true; maximumLineCount: 3; elide: Text.ElideRight }
                Button { foreground: Commons.Color.popups.text; text: strings.t("open"); focusable: true; onClicked: root.openPath(modelData.path) }
                Button { foreground: Commons.Color.popups.text; visible: !modelData.read; text: strings.t("read"); focusable: true; enabled: !root.busy; onClicked: root.invoke("read", {id: modelData.id}) }
              }
            }
            PanelSeparator { foreground: Commons.Color.popups.text; Layout.fillWidth: true }
            PlainText { text: strings.t("blog"); font.bold: true }
            PlainText { text: root.snapshot.article ? root.snapshot.article.title : strings.t("unavailable"); Layout.fillWidth: true }
            Button { foreground: Commons.Color.popups.text; visible: !!root.snapshot.article; text: strings.t("open"); focusable: true; onClicked: root.openPath(root.snapshot.article.path) }
          }
        }
      }
    }
  }
}
