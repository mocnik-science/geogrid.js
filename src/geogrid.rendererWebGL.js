"use strict"

/****** RENDERER WEBGL ******/
export class RendererWebGL {
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
    let prevOverwriteColor = null
    let prevOverwriteSize = null
    let prevOverwriteContourColor = null
    let prevOverwriteContourWidth = null
    this._webgl = L.pixiOverlay(utils => {
      const geoJSON = t._data.getGeoJSON()
      // if no geoJSON present, do nothing
      if (geoJSON == null || geoJSON.features == null) return
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
      const needsRefresh =
        prevZoom != zoom ||
        prevOverwriteColor != JSON.stringify(this._data.getOverwriteColor()) ||
        prevOverwriteSize != JSON.stringify(this._data.getOverwriteSize()) ||
        prevOverwriteContourColor != JSON.stringify(this._data.getOverwriteContourColor()) ||
        prevOverwriteContourWidth != JSON.stringify(this._data.getOverwriteContourWidth())
      prevZoom = zoom
      prevOverwriteColor = JSON.stringify(this._data.getOverwriteColor())
      prevOverwriteSize = JSON.stringify(this._data.getOverwriteSize())
      prevOverwriteContourColor = JSON.stringify(this._data.getOverwriteContourColor())
      prevOverwriteContourWidth = JSON.stringify(this._data.getOverwriteContourWidth())
      // if new geoJSON, cleanup and initialize
      if (geoJSON._webgl_initialized == null || needsRefresh) {
        geoJSON._webgl_initialized = true
        pixiGraphics.clear()
        pixiGraphics.lineStyle(t._options.cellContourWidth / scale, cellContourColor, 1)
      }
      // draw geoJSON features
      for (const feature of geoJSON.features) {
        const notInitialized = feature._webgl_coordinates == null
        if (notInitialized) feature._webgl_coordinates = t._data.cellSize(feature.properties.id, feature.properties, feature.geometry.coordinates[0]).map(c => project([c[1], c[0]]))
        if (notInitialized || needsRefresh) {
          // contour
          const contourColor = t._data.cellContourColor(feature.properties.id, true)
          const contourWidth = t._data.cellContourWidth(feature.properties.id, true)
          const considerContour = contourColor !== null || contourWidth !== null
          if (considerContour) pixiGraphics.lineStyle((contourWidth !== null ? contourWidth : t._options.cellContourWidth) / scale, contourColor !== null ? pixiColor(contourColor) : cellContourColor, 1)
          // draw
          pixiGraphics.beginFill(pixiColor(t._data.cellColor(feature.properties.id, feature.properties)), t._options.cellColorOpacity)
          pixiGraphics.drawPolygon([].concat(...feature._webgl_coordinates.map(c => [c.x, c.y])))
          pixiGraphics.endFill()
          // contour
          if (considerContour) pixiGraphics.lineStyle(t._options.cellContourWidth / scale, cellContourColor, 1)
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
