# MODNet – Real-Time Trimap-Free Portrait Matting

This repository provides an ONNX version of the MODNet model for alpha matting.

---

## Original Resources

- **Original repository:** [https://github.com/ZHKKKe/MODNet](https://github.com/ZHKKKe/MODNet)  
- **Paper:** [https://arxiv.org/abs/2011.11961](https://arxiv.org/abs/2011.11961)  

---

## License

The original MODNet code and models are licensed under the **Apache License 2.0**.  
See the [LICENSE](https://github.com/ZHKKKe/MODNet/blob/master/LICENSE) file in the original repository for details.

---

## Exporting MODNet to ONNX

The official MODNet repository provides an export script at `onnx/export_onnx.py`.  
To export the ONNX version of MODNet (assuming you are in the project root directory):

1. **Download the pre-trained Image Matting Model** from the official repo and place it in:
```
MODNet/pretrained/
```

2. **Install dependencies**:
```bash
pip install -r onnx/requirements.txt
```

3. **Export the ONNX model**:
```bash
python -m onnx.export_onnx \
    --ckpt-path=pretrained/modnet_photographic_portrait_matting.ckpt \
    --output-path=pretrained/modnet_photographic_portrait_matting.onnx
```

4. **Run inference**:
```bash
python -m onnx.inference_onnx \
    --image-path=$FILENAME_OF_INPUT_IMAGE$ \
    --output-path=$FILENAME_OF_OUTPUT_MATTE$ \
    --model-path=pretrained/modnet_photographic_portrait_matting.onnx
```

---

## Note

The official MODNet repository **does not** publish a pre-exported ONNX model.  
This repository hosts an ONNX file generated from the official checkpoint using the official export script for convenience.

---

## Citation

If you use this model in your research, please cite:

```bibtex
@InProceedings{MODNet,
  author = {Zhanghan Ke and Jiayu Sun and Kaican Li and Qiong Yan and Rynson W.H. Lau},
  title = {MODNet: Real-Time Trimap-Free Portrait Matting via Objective Decomposition},
  booktitle = {AAAI},
  year = {2022},
}
```
