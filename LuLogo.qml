import QtQuick
import QtQuick.Effects
import qs.Commons
import qs.Commons as Commons

// Keep LU's original silhouette; tint its alpha with the live shell palette.
Item {
  id: root
  property color color: Commons.Color.foreground
  implicitWidth: Style.bar.iconCanvas
  implicitHeight: Style.bar.iconCanvas

  Image {
    id: mark
    anchors.fill: parent
    source: Qt.resolvedUrl("assets/lu-mark.png")
    fillMode: Image.PreserveAspectFit
    sourceSize.width: Math.ceil(width * Screen.devicePixelRatio)
    sourceSize.height: Math.ceil(height * Screen.devicePixelRatio)
    visible: false
    layer.enabled: true
  }
  Rectangle {
    anchors.fill: parent
    color: root.color
    layer.enabled: true
    layer.effect: MultiEffect {
      maskEnabled: true
      maskSource: mark
      maskThresholdMin: 0.5
      maskSpreadAtMin: 1.0
    }
  }
}
