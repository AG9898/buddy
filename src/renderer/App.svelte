<script lang="ts">
  import { onMount } from 'svelte'
  import PetSprite from './PetSprite.svelte'

  let currentState = $state('idle')
  let activePet = $state<ActivePet | null>(null)

  function stateForPet(pet: ActivePet): string {
    if (pet.manifest.states[pet.initialState]) return pet.initialState
    if (pet.manifest.states['idle']) return 'idle'
    return Object.keys(pet.manifest.states)[0] ?? 'idle'
  }

  function applyActivePet(pet: ActivePet): void {
    activePet = pet
    currentState = stateForPet(pet)
  }

  onMount(() => {
    let destroyed = false
    let receivedLivePet = false
    let rendererReady = false

    function signalRendererReady(): void {
      if (rendererReady) return
      rendererReady = true
      window.petApi.rendererReady()
    }

    const removeStateChange = window.petApi.onStateChange((payload) => {
      currentState = payload.state
    })

    const removeActivePetChange = window.petApi.onActivePetChange((pet) => {
      receivedLivePet = true
      applyActivePet(pet)
      signalRendererReady()
    })

    void window.petApi.getActivePet().then((pet) => {
      if (destroyed) return
      // A live selection may beat the startup invoke. Keep the newer selection.
      if (!receivedLivePet) applyActivePet(pet)
      // Signal the main process that the renderer has the active pet and is ready to be shown.
      signalRendererReady()
    })

    return () => {
      destroyed = true
      removeStateChange()
      removeActivePetChange()
    }
  })
</script>

<main>
  {#if activePet}
    <PetSprite state={currentState} pet={activePet.manifest} spritesheetUrl={activePet.spritesheetUrl} />
  {/if}
</main>
