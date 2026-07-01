// SPDX-License-Identifier: AGPL-3.0
// This file contains code adapted from hey-1 (https://github.com/slymnoyann/hey-1),
// which is licensed under the GNU General Public License v3.0.
// Copyright (C) 2024 Slymn Oyan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { defaultHandlers } from "mdast-util-to-markdown";

const defaultBreakHandler = defaultHandlers.break;

export const customBreakHandler: typeof defaultBreakHandler = (...args) => {
  const output: string = defaultBreakHandler(...args);
  if (output === "\\\n") {
    return "\n";
  }
  return output;
};
