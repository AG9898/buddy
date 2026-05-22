<script lang="ts">
  import { onMount } from 'svelte'
  import PetSprite from './PetSprite.svelte'

  let currentState = $state('idle')

  onMount(() => {
    // Signal the main process that the renderer is live and ready to be shown.
    window.petApi.rendererReady()

    window.petApi.onStateChange((payload) => {
      currentState = payload.state
    })
  })
</script>

<main>
  <PetSprite state={currentState} />
</main>
