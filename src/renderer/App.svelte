<script lang="ts">
  import { onMount } from 'svelte'
  import PetSprite from './PetSprite.svelte'

  let currentState = $state('idle')
  let activePet = $state<ActivePet | null>(null)

  onMount(() => {
    window.petApi.onStateChange((payload) => {
      currentState = payload.state
    })

    void window.petApi.getActivePet().then((pet) => {
      activePet = pet
      currentState = pet.manifest.states[pet.initialState] ? pet.initialState : 'idle'
      // Signal the main process that the renderer has the active pet and is ready to be shown.
      window.petApi.rendererReady()
    })
  })
</script>

<main>
  {#if activePet}
    <PetSprite state={currentState} pet={activePet.manifest} spritesheetUrl={activePet.spritesheetUrl} />
  {/if}
</main>
