### A Pluto.jl notebook ###
# v0.20.21

using Markdown
using InteractiveUtils

# ╔═╡ b3dd438a-274d-4e19-a381-a534cb99ac57
using PlutoUI

# ╔═╡ ae645f90-2392-4829-8a7c-75053c87fd99
md"""
# 弹簧振子虚拟仿真

拖动参数即可重新计算。教师只需修改下方 Julia 公式，学生无需安装软件。
"""

# ╔═╡ 7da534d2-cd8b-43a2-95f3-67ccf4b8cfe4
@bind stiffness Slider(0.5:0.1:5.0, default=2.0, show_value=true)

# ╔═╡ 6fc99ea7-7ce1-4579-a689-163576d47982
@bind damping Slider(0.0:0.05:1.0, default=0.2, show_value=true)

# ╔═╡ 082d479c-5f38-4a9a-8bf0-1fdcab2d331a
@bind time Slider(0.0:0.05:10.0, default=0.0, show_value=true)

# ╔═╡ 63063b58-8140-41a2-b13e-24e17af6c99c
begin
    frequency = sqrt(max(stiffness - damping^2 / 4, 0))
    position = exp(-damping * time / 2) * cos(frequency * time)
    center = 320 + 180 * position
    HTML("""
    <svg viewBox="0 0 640 240" style="max-width:720px;background:#f7f7f8;border:1px solid #ddd">
      <line x1="40" y1="120" x2="$(center - 32)" y2="120" stroke="#555" stroke-width="5" stroke-dasharray="10 6"/>
      <rect x="$(center - 32)" y="82" width="64" height="76" rx="7" fill="#2474b5"/>
      <line x1="40" y1="175" x2="600" y2="175" stroke="#999" stroke-width="2"/>
      <text x="40" y="215" font-family="sans-serif" font-size="18">x(t) = $(round(position; digits=3))</text>
    </svg>
    """)
end

# ╔═╡ Cell order:
# ╟─ae645f90-2392-4829-8a7c-75053c87fd99
# ╠═b3dd438a-274d-4e19-a381-a534cb99ac57
# ╠═7da534d2-cd8b-43a2-95f3-67ccf4b8cfe4
# ╠═6fc99ea7-7ce1-4579-a689-163576d47982
# ╠═082d479c-5f38-4a9a-8bf0-1fdcab2d331a
# ╠═63063b58-8140-41a2-b13e-24e17af6c99c
