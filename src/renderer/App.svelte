<script lang="ts">
  import { onMount } from 'svelte'
  import PetSprite from './PetSprite.svelte'

  let currentState = $state('idle')

  onMount(() => {
    window.petApi.onStateChange((payload) => {
      currentState = payload.state
    })
  })
</script>

<main>
  <PetSprite state={currentState} />
</main>
