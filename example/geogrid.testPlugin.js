"use strict"

if (typeof L === 'undefined') throw '[geogrid.js] Leaflet and geogrid.js need to be loaded first'

L.TestPlugin = class TestPlugin extends L.ISEA3HLayerPlugin {
  onHover(e) {
    this.setCellColor(e.cell, 'blue')
    this.render()
    // console.debug('hover', e.cell.id)
  }
  onUnhover(e) {
    this.setCellColor(e.cell, null)
    this.render()
    // console.debug('unhover', e.cell.id)
  }
  onClick(e) {
    this.neighbors(e.cell, ns => console.debug(ns))
    // this.setParameter('dateFrom', '2017-01-01')
    // this.downloadData()
    // console.debug('click', e.cell.id, e.data.value)
  }
}

L.testPlugin = () => new L.TestPlugin()
