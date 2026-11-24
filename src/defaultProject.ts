// Copyright (C) 2026 DON:E (Elias Toft Hansen)
// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadProjectFromFile } from './saveManager'
import type { SavedProject } from './project'

const defaultProjectUrl = new URL('../templates/default.zip', import.meta.url)

export async function loadDefaultProject(): Promise<SavedProject> {
  const response = await fetch(defaultProjectUrl)
  if (!response.ok) throw new Error(`Could not load default project template (${response.status}).`)
  return loadProjectFromFile(await response.blob())
}
