"use strict"

/****** RENDERER WEBGL ******/
module.exports.RendererWebGL = class RendererWebGL {
  constructor(options, progress, data) {
    this._options = options
    this._progress = progress
    this._data = data
  }
  add(map) {
    const t = this
    const pixiColor = color => {
      const c = d3.color(color).rgb()
      return PIXI.utils.rgb2hex([c.r / 255, c.g / 255, c.b / 255])
    }
    const pixiContainer = new PIXI.Container()
    const pixiGraphics = new PIXI.Graphics()
    pixiContainer.addChild(pixiGraphics)
    let prevZoom
    let prevOverwriteColor
    let prevOverwriteSize
    this._webgl = L.pixiOverlay(utils => {
      // if no geoJSON present, do nothing
      if (t._data._geoJSON == null || t._data._geoJSON.features == null) return
      // log
      const renderer = utils.getRenderer()
      t._progress.debugStep(`visualize (${(renderer instanceof PIXI.CanvasRenderer) ? 'Canvas' : 'WebGL'})`, 90)
      // collect utils
      const zoom = utils.getMap().getZoom()
      const container = utils.getContainer()
      const project = utils.latLngToLayerPoint
      const scale = utils.getScale()
      // colours
      const cellContourColor = pixiColor(t._options.cellContourColor)
      // check whether a referesh is need
      const needsRefresh = prevZoom != zoom || prevOverwriteColor != JSON.stringify(this._data._overwriteColor) || prevOverwriteSize != JSON.stringify(this._data._overwriteSize)
      prevZoom = zoom
      prevOverwriteColor = JSON.stringify(this._data._overwriteColor)
      prevOverwriteSize = JSON.stringify(this._data._overwriteSize)
      // if new geoJSON, cleanup and initialize
      if (t._data._geoJSON._webgl_initialized == null || needsRefresh) {
        t._data._geoJSON._webgl_initialized = true
        pixiGraphics.clear()
        pixiGraphics.lineStyle(t._options.cellContourWidth / scale, cellContourColor, 1)
      }
      // draw geoJSON features
      for (const feature of t._data._geoJSON.features) {
        const notInitialized = (feature._webgl_coordinates == null)
        if (notInitialized) feature._webgl_coordinates = t._data.cellSize(feature.properties.id, feature.properties, feature.geometry.coordinates[0]).map(c => project([c[1], c[0]]))
        if (notInitialized || needsRefresh) {
          pixiGraphics.beginFill(pixiColor(t._data.cellColor(feature.properties.id, feature.properties)), t._options.cellColorOpacity)
          pixiGraphics.drawPolygon([].concat(...feature._webgl_coordinates.map(c => [c.x, c.y])))
          pixiGraphics.endFill()
        }
      }
      renderer.render(container)
      t._progress.debugFinished()
    }, pixiContainer).addTo(map)
  }
  remove(map) {
    this._webgl.remove()
  }
  render(geoJSON) {
    this._webgl._update(null)
  }
  update(geoJSON) {}
}
