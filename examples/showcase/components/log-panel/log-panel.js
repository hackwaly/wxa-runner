Component({
  properties: {
    logs: { type: Array, value: [] }
  },
  methods: {
    clear() {
      this.triggerEvent('clear')
    }
  }
})
