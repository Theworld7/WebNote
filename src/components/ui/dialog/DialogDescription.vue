<script setup lang="ts">
import type { DialogDescriptionProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogDescription } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<DialogDescriptionProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <DialogDescription
    data-slot="dialog-description"
    v-bind="delegatedProps"
    :class="cn('text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3', props.class)"
  >
    <slot />
  </DialogDescription>
</template>
